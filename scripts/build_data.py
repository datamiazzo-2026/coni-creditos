#!/usr/bin/env python3
"""
Convierte el Excel de préstamos al sector agro (hojas "SALDOS" y "TASAS")
al JSON que consume el dashboard (data/dashboard_data.json).

Uso:
    python3 scripts/build_data.py "PRESTAMOS AL SECTOR AGRO.xlsx" data/dashboard_data.json

Convención de MONEDA en la hoja de SALDOS:
    0 = Total (pesos + dólares, en pesos)
    1 = Pesos
    2 = Dólares, expresado en su equivalente en pesos

    moneda1 + moneda2 == moneda0 (fila a fila). Para obtener el saldo real
    en dólares de una fila, se divide su TOTAL por el TIPO DE CAMBIO de esa
    misma fila (columna D de SALDOS).

En TASAS no existe moneda 0 (no aplica un total de tasa): solo 1 (pesos) y
2 (dólares).

Si en un trimestre nuevo aparece alguna actividad que hoy está en la lista
de "parciales" (PARTIAL_ACTS) con series completas, simplemente pasa a
completarse sola: el script arma la serie con lo que encuentre fila a fila,
no hace falta tocar las listas de actividades.
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

import openpyxl

PROVINCIAS = [
    'CABA', 'BS AS', 'Catamarca', 'Córdoba', 'Corrientes', 'Chaco', 'Chubut',
    'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza',
    'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis',
    'Santa Cruz', 'Santa Fe', 'Santiago del estero', 'Tierra del fuego', 'Tucumán',
]

# Actividades con serie completa (4 trimestres, discriminadas por moneda) al
# cierre de 2025. Se actualiza sola si en el futuro se completan las otras.
COMPLETE_ACTS = [
    'Cereales, oleaginosas y forrajeras',
    'Frutas -excepto vid para vinificar- y nueces',
    'Vid para vinificar',
    'Tabaco',
    'Bovino -excepto en cabañas y para la producción de leche-',
    'Ovino -excepto en cabañas y para la producción de lana-',
    'Porcino -excepto en cabañas-',
    'Producción de leche (incluye la cría de ganado para la producción de leche)',
]
PARTIAL_ACTS = [
    'Producción de granja y cría de animales (excepto ganado)',
    'Producción y procesamiento de carne, pescado, frutas, legumbres, hortalizas, aceites y grasas',
    'Elaboración de productos lácteos',
    'Elaboración de productos de molinería, almidones y productos derivados del almidón; elaboración de alimentos preparados para animales',
]

ICONS = {
    'Cereales, oleaginosas y forrajeras': '🌾',
    'Frutas -excepto vid para vinificar- y nueces': '🍎',
    'Vid para vinificar': '🍇',
    'Tabaco': '🌿',
    'Bovino -excepto en cabañas y para la producción de leche-': '🐄',
    'Ovino -excepto en cabañas y para la producción de lana-': '🐑',
    'Porcino -excepto en cabañas-': '🐖',
    'Producción de leche (incluye la cría de ganado para la producción de leche)': '🥛',
    'Producción de granja y cría de animales (excepto ganado)': '🐓',
    'Producción y procesamiento de carne, pescado, frutas, legumbres, hortalizas, aceites y grasas': '🥩',
    'Elaboración de productos lácteos': '🧀',
    'Elaboración de productos de molinería, almidones y productos derivados del almidón; elaboración de alimentos preparados para animales': '🌽',
}
SHORT_NAMES = {
    'Frutas -excepto vid para vinificar- y nueces': 'Frutas y nueces',
    'Bovino -excepto en cabañas y para la producción de leche-': 'Bovino',
    'Ovino -excepto en cabañas y para la producción de lana-': 'Ovino',
    'Porcino -excepto en cabañas-': 'Porcino',
    'Producción de leche (incluye la cría de ganado para la producción de leche)': 'Producción de leche',
    'Producción de granja y cría de animales (excepto ganado)': 'Granja y otros animales',
    'Producción y procesamiento de carne, pescado, frutas, legumbres, hortalizas, aceites y grasas': 'Procesamiento de carnes y alimentos',
    'Elaboración de productos lácteos': 'Elaboración de lácteos',
    'Elaboración de productos de molinería, almidones y productos derivados del almidón; elaboración de alimentos preparados para animales': 'Molinería y alimento balanceado',
}


def slugify(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    s = re.sub(r'[^a-zA-Z0-9]+', '-', s).strip('-').lower()
    return s[:30]


def period_label(p):
    p = str(p)
    month = {'03': 'Mar', '06': 'Jun', '09': 'Sep', '12': 'Dic'}[p[4:6]]
    return f"{month}-{p[2:4]}"


def read_sheet(ws, value_col_name):
    records = []
    for r in range(2, ws.max_row + 1):
        act = ws.cell(row=r, column=1).value
        if act is None:
            continue
        per = ws.cell(row=r, column=2).value
        mon = ws.cell(row=r, column=3).value
        val_or_tc = ws.cell(row=r, column=4).value
        total = ws.cell(row=r, column=5).value
        provs = {p: ws.cell(row=r, column=6 + i).value for i, p in enumerate(PROVINCIAS)}
        records.append({'actividad': act, 'periodo': per, 'moneda': mon, value_col_name: val_or_tc,
                         'total': total, 'provincias': provs})
    return records


def build(xlsx_path, out_path):
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    saldos = read_sheet(wb['2025 - SALDOS'], 'tc')
    tasas = read_sheet(wb['2025 - TASAS'], 'tasas_nac')

    periodos = sorted({r['periodo'] for r in saldos})
    periodos_label = {p: period_label(p) for p in periodos}

    idx = {(r['actividad'], r['periodo'], r['moneda']): r for r in saldos}
    idx_tasas = {(r['actividad'], r['periodo'], r['moneda']): r for r in tasas}

    all_acts_in_sheet = list(dict.fromkeys(r['actividad'] for r in saldos))
    ordered_acts = [a for a in COMPLETE_ACTS if a in all_acts_in_sheet] \
        + [a for a in PARTIAL_ACTS if a in all_acts_in_sheet] \
        + [a for a in all_acts_in_sheet if a not in COMPLETE_ACTS and a not in PARTIAL_ACTS]

    out_acts = []
    for act in ordered_acts:
        series = []
        for per in periodos:
            r0 = idx.get((act, per, 0))
            if r0 is None:
                series.append(None)
                continue
            r1, r2 = idx.get((act, per, 1)), idx.get((act, per, 2))
            tc, total_ars = r0['tc'], r0['total']
            pesos_ars = r1['total'] if r1 else None
            dolares_ars_equiv = r2['total'] if r2 else None
            dolares_usd = round(dolares_ars_equiv / tc) if (dolares_ars_equiv and tc) else None
            total_usd = round(total_ars / tc) if tc else None
            series.append({'periodo': per, 'tc': tc, 'total_ars': total_ars, 'pesos_ars': pesos_ars,
                            'dolares_usd': dolares_usd, 'total_usd': total_usd})

        n_completos = sum(1 for s in series if s)
        completa = n_completos == len(periodos) and all(
            idx.get((act, p, 1)) and idx.get((act, p, 2)) for p in periodos if idx.get((act, p, 0))
        )

        last_per = next((p for p in reversed(periodos) if idx.get((act, p, 0))), None)
        provs_total_ars, provs_pesos_ars, provs_dolares_usd, provs_total_usd = {}, {}, {}, {}
        if last_per:
            tc_last = idx[(act, last_per, 0)]['tc']
            provs_total_ars = idx[(act, last_per, 0)]['provincias']
            r1l, r2l = idx.get((act, last_per, 1)), idx.get((act, last_per, 2))
            provs_pesos_ars = r1l['provincias'] if r1l else {}
            if r2l:
                provs_dolares_usd = {p: (round(v / tc_last) if v is not None and tc_last else None)
                                      for p, v in r2l['provincias'].items()}
            provs_total_usd = {p: (round(v / tc_last) if v is not None and tc_last else None)
                                for p, v in provs_total_ars.items()}

        tasas_series = []
        for per in periodos:
            t1, t2 = idx_tasas.get((act, per, 1)), idx_tasas.get((act, per, 2))
            tasas_series.append({'periodo': per, 'pesos': t1['tasas_nac'] if t1 else None,
                                  'dolares': t2['tasas_nac'] if t2 else None})
        t1l, t2l = idx_tasas.get((act, last_per, 1)), idx_tasas.get((act, last_per, 2))

        out_acts.append({
            'id': slugify(act),
            'nombre': SHORT_NAMES.get(act, act),
            'nombre_completo': act,
            'icono': ICONS.get(act, '🌱'),
            'completa': completa,
            'series': series,
            'provincias': {'total_ars': provs_total_ars, 'pesos_ars': provs_pesos_ars,
                            'dolares_usd': provs_dolares_usd, 'total_usd': provs_total_usd},
            'ultimo_periodo': last_per,
            'tasas': tasas_series,
            'tasas_provincias': {
                'pesos': (t1l['provincias'] if t1l else {}),
                'dolares': (t2l['provincias'] if t2l else {}),
            },
        })

    data = {'periodos': periodos, 'periodos_label': periodos_label,
            'provincias': PROVINCIAS, 'actividades': out_acts}

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    print(f"OK: {len(out_acts)} actividades, {len(periodos)} períodos -> {out_path}")


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    build(sys.argv[1], sys.argv[2])
