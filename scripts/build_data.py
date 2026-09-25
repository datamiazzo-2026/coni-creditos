#!/usr/bin/env python3
"""
Convierte los Excel de préstamos al sector agro al JSON que consume el
dashboard (data/dashboard_data.json).

Acepta DOS formatos de fuente, y podés pasar varios archivos juntos (uno por
año, por ejemplo) para que el dashboard muestre la serie completa:

1. "Limpio" (.xlsx, hojas "<algo> - SALDOS" / "<algo> - TASAS"): es el
   formato ya filtrado a las 12 actividades agro, tal como lo arma CONINAGRO
   a mano a partir de la base completa del BCRA. Es el que veníamos usando
   para 2025.

2. "Crudo BCRA" (.xls, hojas "Saldos" / "Tasas" / "Observaciones"): es el
   reporte SISCEN completo tal cual lo exporta el BCRA, con TODAS las
   actividades económicas del país (no solo agro) en una estructura
   jerárquica (CIIU/CLANAE), y separado en columnas por provincia con
   algunas columnas "trampa" (ver comentarios en `read_raw_bcra_sheet`).
   El script identifica solo a las 12 actividades agro por nombre exacto,
   sin que haga falta filtrarlo a mano antes.

Uso:
    pip install openpyxl xlrd
    python3 scripts/build_data.py data/dashboard_data.json \\
        data/source/PRESTAMOS_AL_SECTOR_AGRO_2025.xlsx \\
        data/source/act2024.xls

El orden de los archivos no importa: los períodos de todas las fuentes se
combinan y se ordenan solos. Si un trimestre aparece en más de una fuente,
gana el de la fuente que se haya listado último en la línea de comando.

Convención de MONEDA (misma en ambos formatos):
    0 = Total (pesos + dólares, en pesos) -- no existe en TASAS
    1 = Pesos
    2 = Dólares, expresado en su equivalente en pesos

    moneda1 + moneda2 == moneda0 (fila a fila) en SALDOS. Para obtener el
    saldo real en dólares de una fila se divide su TOTAL por el TIPO DE
    CAMBIO de esa misma fila.

Si en un trimestre nuevo aparece alguna actividad que hoy está en la lista
de "parciales" (PARTIAL_ACTS) con series completas, simplemente pasa a
completarse sola: el script arma la serie con lo que encuentre fila a fila,
no hace falta tocar las listas de actividades. La completitud
(saldos_total_completo / saldos_moneda_completo / tasas_completo) se
recalcula siempre sobre TODOS los períodos combinados, no hay que avisarle
al script cuántos trimestres hay.
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
ACT_NAMES = COMPLETE_ACTS + PARTIAL_ACTS

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


def norm(s):
    """Normaliza un texto para comparar encabezados sin que rompan tildes,
    mayúsculas o espacios de más (usado solo para validar columnas, nunca
    para los nombres de actividad que van al JSON)."""
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode()
    return re.sub(r'\s+', ' ', s).strip().lower()


def period_label(p):
    p = str(p)
    month = {'03': 'Mar', '06': 'Jun', '09': 'Sep', '12': 'Dic'}[p[4:6]]
    return f"{month}-{p[2:4]}"


# ---------------------------------------------------------------------------
# Formato "limpio" (.xlsx, ya filtrado a las 12 actividades agro)
# ---------------------------------------------------------------------------

def read_clean_sheet(ws, value_col_name, total_col, prov_start_col):
    """Lee una hoja fila a fila. Las dos hojas fuente tienen distinta cantidad
    de columnas antes del desglose por provincia:
      SALDOS: A ACTIVIDAD, B PERIODO, C MONEDA, D TIPO DE CAMBIO, E TOTAL, F.. provincias
      TASAS:  A ACTIVIDAD, B PERIODO, C MONEDA, D TOTAL,          E.. provincias
    (TASAS no tiene columna de tipo de cambio, así que el total y el inicio del
    desglose por provincia están un lugar más a la izquierda que en SALDOS).
    total_col/prov_start_col hacen explícito ese corrimiento en vez de asumir
    siempre la misma distancia de columnas.
    """
    records = []
    for r in range(2, ws.max_row + 1):
        act = ws.cell(row=r, column=1).value
        if act is None:
            continue
        per = ws.cell(row=r, column=2).value
        mon = ws.cell(row=r, column=3).value
        val_or_tc = ws.cell(row=r, column=4).value
        total = ws.cell(row=r, column=total_col).value
        provs = {p: ws.cell(row=r, column=prov_start_col + i).value for i, p in enumerate(PROVINCIAS)}
        rec = {'actividad': act, 'periodo': int(per), 'moneda': int(mon),
               'total': total, 'provincias': provs}
        if value_col_name == 'tc':
            rec['tc'] = val_or_tc
        records.append(rec)
    return records


def read_clean_workbook(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    saldos_name = next(n for n in wb.sheetnames if 'saldos' in n.lower())
    tasas_name = next(n for n in wb.sheetnames if 'tasas' in n.lower())
    saldos = read_clean_sheet(wb[saldos_name], 'tc', total_col=5, prov_start_col=6)
    tasas = read_clean_sheet(wb[tasas_name], 'total', total_col=4, prov_start_col=5)
    return saldos, tasas


# ---------------------------------------------------------------------------
# Formato "crudo BCRA" (.xls, reporte SISCEN completo, todas las actividades)
# ---------------------------------------------------------------------------
#
# Este es el export tal cual lo entrega el BCRA (hojas "Saldos"/"Tasas"), con
# una fila por actividad económica x fecha x moneda, en una jerarquía
# CIIU/CLANAE de ~5 niveles (columnas nom01..nom05: el nombre de la actividad
# aparece en la columna del nivel que le toca según su profundidad en el
# árbol, no siempre en la misma). Encontramos las 12 actividades agro
# buscando coincidencia EXACTA de texto en cualquiera de esas 5 columnas, así
# no hace falta que alguien filtre el archivo a mano antes de pasárselo al
# script.
#
# OJO con las columnas de provincia: no son un bloque contiguo. Cada hoja
# tiene DOS trampas que detectamos comparando contra los encabezados y
# verificando que las columnas sumen al total:
#   1) Después de "CABA" viene una columna "Buenos Aires" que en realidad es
#      un TOTAL (Gran Buenos Aires + Resto de Buenos Aires sumados), seguida
#      de esas dos columnas de detalle. Si se usan las tres se cuenta la
#      provincia dos veces. Nos quedamos solo con el total de Buenos Aires y
#      saltamos las dos columnas de detalle.
#   2) La hoja de Tasas no tiene columna de tipo de cambio (igual que en el
#      formato limpio).
# El resto de las provincias sí son un bloque contiguo y en el mismo orden
# que PROVINCIAS.
#
# Para blindarnos ante que el BCRA cambie el orden de columnas en un export
# futuro, `read_raw_bcra_sheet` valida el texto del encabezado de cada
# columna de provincia contra lo esperado antes de confiar en el índice fijo,
# y frena con un error claro si no coincide (en vez de guardar datos
# corridos de provincia, como pasó una vez con el formato limpio).

def _header_text(ws, cols, rows):
    """Junta en un solo string el texto de varias filas/columnas de
    encabezado (los títulos de provincia vienen partidos en 2-3 renglones,
    y a veces el texto queda "pegado" a la columna vecina por cómo el BCRA
    arma las celdas combinadas -- ver comentario de BS AS más abajo)."""
    cols = [cols] if isinstance(cols, int) else cols
    parts = []
    for r in rows:
        for c in cols:
            v = ws.cell_value(r, c)
            v = str(v).strip() if v not in (None, '') else ''
            if v:
                parts.append(v)
    return norm(' '.join(parts))


def _find_header_row(ws, col0_value='orden'):
    for r in range(ws.nrows):
        v = ws.cell_value(r, 0)
        if isinstance(v, str) and v.strip().lower() == col0_value:
            return r
    raise ValueError(f"No encontré la fila de encabezado ('{col0_value}' en columna A)")


def _validate_prov_columns(ws, prov_cols, header_rows):
    """prov_cols: dict {nombre_provincia: columna}. Compara el encabezado
    normalizado de cada columna contra el nombre de provincia (también
    normalizado) y aborta si no aparece como substring -- señal de que el
    layout de columnas cambió y los índices fijos ya no valen."""
    # alias porque el BCRA no siempre escribe el nombre de provincia igual
    # que nuestra lista interna (p.ej. "Buenos Aires" vs "BS AS").
    aliases = {
        'CABA': ['caba', 'capital federal', 'ciudad autonoma'],
        'BS AS': ['buenos aires'],
        'Santiago del estero': ['santiago del estero'],
        'Tierra del fuego': ['tierra del fuego'],
    }
    # "BS AS" es la columna con la trampa: es el TOTAL de la provincia, pero
    # el texto "Buenos Aires" del encabezado del BCRA queda "pegado" a la
    # columna de al lado (el detalle Gran Buenos Aires / Resto), no a esta
    # columna. Miramos también la columna siguiente solo para esta
    # provincia -- el resto se valida estricto, columna por columna.
    lookahead = {'BS AS': 1}
    for prov, col in prov_cols.items():
        cols = [col + i for i in range(lookahead.get(prov, 0) + 1)]
        header = _header_text(ws, cols, header_rows)
        needles = aliases.get(prov, [norm(prov)])
        if not any(n in header for n in needles):
            raise ValueError(
                f"Columna {col} no parece ser '{prov}' (encabezado: {header!r}). "
                "El layout del export crudo del BCRA puede haber cambiado -- "
                "revisá read_raw_bcra_sheet antes de confiar en estos datos."
            )


def read_raw_bcra_sheet(ws, total_col, prov_cols, header_rows, tc_col=None, check_sum=False, round_values=True):
    """Lee la hoja cruda del BCRA y devuelve solo las filas de las 12
    actividades agro (ACT_NAMES), en el mismo formato de record que
    read_clean_sheet: {'actividad','periodo','moneda','total','provincias'[,'tc']}.

    check_sum=True agrega una segunda verificación, además de la de
    encabezados: que CABA + provincias sumen (aprox.) el total de la fila.
    Solo tiene sentido para montos (SALDOS); una tasa de interés no es la
    suma de las tasas por provincia, así que TASAS no la usa.

    round_values redondea total/provincias a entero -- tiene sentido para
    SALDOS (son pesos) pero NO para TASAS (son tasas en %, con decimales
    significativos: 49.32% no es lo mismo que 49%)."""
    _validate_prov_columns(ws, prov_cols, header_rows)
    header_row = _find_header_row(ws)
    name_cols = [4, 5, 6, 7, 8]  # nom01..nom05
    records = []
    for r in range(header_row + 1, ws.nrows):
        act = None
        for c in name_cols:
            v = ws.cell_value(r, c)
            if isinstance(v, str) and v.strip() in ACT_NAMES:
                act = v.strip()
                break
        if act is None:
            continue
        per = ws.cell_value(r, 9)
        mon = ws.cell_value(r, 10)
        if per == '' or mon == '':
            continue
        total = ws.cell_value(r, total_col)
        total = total if isinstance(total, (int, float)) else None
        provs = {}
        for p, c in prov_cols.items():
            v = ws.cell_value(r, c)
            if not isinstance(v, (int, float)):
                provs[p] = None
            else:
                provs[p] = round(v) if round_values else v
        rec = {'actividad': act, 'periodo': int(per), 'moneda': int(mon),
               'total': (round(total) if round_values else total) if total is not None else None,
               'provincias': provs}
        if tc_col is not None:
            tc = ws.cell_value(r, tc_col)
            rec['tc'] = tc if isinstance(tc, (int, float)) else None
        records.append(rec)

    if check_sum:
        checked = 0
        for rec in records:
            vals = [v for v in rec['provincias'].values() if v is not None]
            if rec['total'] is None or len(vals) < len(rec['provincias']) - 2:
                continue  # fila con demasiados huecos, no sirve para validar
            suma = sum(vals)
            if rec['total'] and abs(suma - rec['total']) / abs(rec['total']) > 0.01:
                raise ValueError(
                    f"Las provincias de '{rec['actividad']}' ({rec['periodo']}, moneda {rec['moneda']}) "
                    f"suman {suma:,.0f} pero el total de la columna es {rec['total']:,.0f} "
                    "(más de 1% de diferencia). Puede haber una columna de provincia mal "
                    "mapeada -- revisá prov_cols en read_raw_bcra_workbook."
                )
            checked += 1
        if checked == 0:
            raise ValueError("check_sum=True pero no pude validar ninguna fila (¿cambió el formato?).")
    return records


def read_raw_bcra_workbook(path):
    import xlrd
    wb = xlrd.open_workbook(path)
    saldos_name = next(n for n in wb.sheet_names() if n.lower() == 'saldos')
    tasas_name = next(n for n in wb.sheet_names() if n.lower() == 'tasas')

    saldos_prov_cols = {
        'CABA': 13, 'BS AS': 14, 'Catamarca': 17, 'Córdoba': 18, 'Corrientes': 19,
        'Chaco': 20, 'Chubut': 21, 'Entre Ríos': 22, 'Formosa': 23, 'Jujuy': 24,
        'La Pampa': 25, 'La Rioja': 26, 'Mendoza': 27, 'Misiones': 28, 'Neuquén': 29,
        'Río Negro': 30, 'Salta': 31, 'San Juan': 32, 'San Luis': 33, 'Santa Cruz': 34,
        'Santa Fe': 35, 'Santiago del estero': 36, 'Tierra del fuego': 37, 'Tucumán': 38,
    }
    tasas_prov_cols = {
        'CABA': 12, 'BS AS': 13, 'Catamarca': 16, 'Córdoba': 17, 'Corrientes': 18,
        'Chaco': 19, 'Chubut': 20, 'Entre Ríos': 21, 'Formosa': 22, 'Jujuy': 23,
        'La Pampa': 24, 'La Rioja': 25, 'Mendoza': 26, 'Misiones': 27, 'Neuquén': 28,
        'Río Negro': 29, 'Salta': 30, 'San Juan': 31, 'San Luis': 32, 'Santa Cruz': 33,
        'Santa Fe': 34, 'Santiago del estero': 35, 'Tierra del fuego': 36, 'Tucumán': 37,
    }

    sh_saldos = wb.sheet_by_name(saldos_name)
    sh_tasas = wb.sheet_by_name(tasas_name)
    header_rows_saldos = range(5, 12)
    header_rows_tasas = range(17, 25)

    saldos = read_raw_bcra_sheet(sh_saldos, total_col=12, prov_cols=saldos_prov_cols,
                                  header_rows=header_rows_saldos, tc_col=11, check_sum=True)
    tasas = read_raw_bcra_sheet(sh_tasas, total_col=11, prov_cols=tasas_prov_cols,
                                 header_rows=header_rows_tasas, tc_col=None, round_values=False)
    return saldos, tasas


def read_any_workbook(path):
    ext = Path(path).suffix.lower()
    if ext == '.xlsx':
        return read_clean_workbook(path)
    if ext == '.xls':
        return read_raw_bcra_workbook(path)
    raise ValueError(f"Formato no soportado: {path} (esperaba .xlsx o .xls)")


# ---------------------------------------------------------------------------
# Resumen nacional: tasa ponderada, y costo efectivo dólares vs. pesos
# ---------------------------------------------------------------------------
#
# Tasa ponderada de un período = promedio de la tasa de cada actividad,
# ponderado por el peso relativo de esa actividad sobre el saldo total (en
# esa misma moneda) del período. Se calcula por separado en pesos y en
# dólares, porque el peso de cada actividad no es el mismo en cada moneda
# (ej.: cerealera concentra mucho más crédito en dólares que en pesos).
#
# Costo efectivo del crédito en dólares, expresado en pesos = combina la
# tasa ponderada en dólares con la devaluación interanual (4 trimestres)
# realizada, para poder compararla de igual a igual contra la tasa
# ponderada en pesos. No existe para los primeros 4 trimestres de la serie
# (no hay "hace un año" contra qué comparar el tipo de cambio).

def build_resumen_nacional(periodos, out_acts):
    resumen = []
    for i, per in enumerate(periodos):
        pesos_num = pesos_den = 0.0
        dolares_num = dolares_den = 0.0
        total_ars_nacional = 0.0
        tcs = []
        for act in out_acts:
            s = act['series'][i]
            t = act['tasas'][i]
            if s and s.get('pesos_ars') and t.get('pesos') is not None:
                pesos_num += s['pesos_ars'] * t['pesos']
                pesos_den += s['pesos_ars']
            if s and s.get('dolares_usd') and t.get('dolares') is not None:
                dolares_num += s['dolares_usd'] * t['dolares']
                dolares_den += s['dolares_usd']
            if s and s.get('total_ars'):
                total_ars_nacional += s['total_ars']
            if s and s.get('tc'):
                tcs.append(s['tc'])
        if tcs and (max(tcs) - min(tcs)) / max(tcs) > 0.001:
            raise ValueError(
                f"El tipo de cambio no coincide entre actividades en el período {per}: {tcs} "
                "-- se esperaba el mismo TC nacional para todas."
            )
        resumen.append({
            'periodo': per,
            'tasa_pesos_ponderada': round(pesos_num / pesos_den, 2) if pesos_den else None,
            'tasa_dolares_ponderada': round(dolares_num / dolares_den, 2) if dolares_den else None,
            'tc': tcs[0] if tcs else None,
            'total_ars_nacional': round(total_ars_nacional) if total_ars_nacional else None,
        })

    for i, r in enumerate(resumen):
        r_prev = resumen[i - 4] if i >= 4 else None
        if r_prev and r_prev['tc'] and r['tc'] and r['tasa_dolares_ponderada'] is not None:
            var_tc = (r['tc'] / r_prev['tc'] - 1) * 100
            costo = ((1 + r['tasa_dolares_ponderada'] / 100) * (1 + var_tc / 100) - 1) * 100
            r['var_tc_interanual'] = round(var_tc, 2)
            r['costo_efectivo_dolares'] = round(costo, 2)
        else:
            r['var_tc_interanual'] = None
            r['costo_efectivo_dolares'] = None
    return resumen


# ---------------------------------------------------------------------------
# Construcción del JSON final
# ---------------------------------------------------------------------------

def build(source_paths, out_path):
    saldos, tasas = [], []
    for path in source_paths:
        s, t = read_any_workbook(path)
        print(f"  {path}: {len(s)} filas de saldos, {len(t)} filas de tasas")
        saldos += s
        tasas += t

    periodos = sorted({r['periodo'] for r in saldos} | {r['periodo'] for r in tasas})
    periodos_label = {p: period_label(p) for p in periodos}

    # Si un mismo (actividad, período, moneda) aparece en más de una fuente,
    # gana la última fuente pasada en la línea de comando (los diccionarios
    # de Python conservan la última asignación).
    idx = {(r['actividad'], r['periodo'], r['moneda']): r for r in saldos}
    idx_tasas = {(r['actividad'], r['periodo'], r['moneda']): r for r in tasas}

    all_acts_found = {r['actividad'] for r in saldos} | {r['actividad'] for r in tasas}
    ordered_acts = [a for a in COMPLETE_ACTS if a in all_acts_found] \
        + [a for a in PARTIAL_ACTS if a in all_acts_found] \
        + [a for a in all_acts_found if a not in COMPLETE_ACTS and a not in PARTIAL_ACTS]

    out_acts = []
    for act in ordered_acts:
        series = []
        for per in periodos:
            r0 = idx.get((act, per, 0))
            if r0 is None:
                series.append(None)
                continue
            r1, r2 = idx.get((act, per, 1)), idx.get((act, per, 2))
            tc, total_ars = r0.get('tc'), r0['total']
            pesos_ars = r1['total'] if r1 else None
            dolares_ars_equiv = r2['total'] if r2 else None
            dolares_usd = round(dolares_ars_equiv / tc) if (dolares_ars_equiv and tc) else None
            total_usd = round(total_ars / tc) if (total_ars and tc) else None
            series.append({'periodo': per, 'tc': tc, 'total_ars': total_ars, 'pesos_ars': pesos_ars,
                            'dolares_usd': dolares_usd, 'total_usd': total_usd})

        n_completos = sum(1 for s in series if s)
        saldos_total_completo = n_completos == len(periodos)
        saldos_moneda_completo = saldos_total_completo and all(
            idx.get((act, p, 1)) and idx.get((act, p, 2)) for p in periodos
        )

        last_per = next((p for p in reversed(periodos) if idx.get((act, p, 0))), None)
        provs_total_ars, provs_pesos_ars, provs_dolares_usd, provs_total_usd = {}, {}, {}, {}
        if last_per:
            tc_last = idx[(act, last_per, 0)].get('tc')
            provs_total_ars = idx[(act, last_per, 0)]['provincias']
            r1l, r2l = idx.get((act, last_per, 1)), idx.get((act, last_per, 2))
            provs_pesos_ars = r1l['provincias'] if r1l else {}
            if r2l and tc_last:
                provs_dolares_usd = {p: (round(v / tc_last) if v is not None else None)
                                      for p, v in r2l['provincias'].items()}
            if tc_last:
                provs_total_usd = {p: (round(v / tc_last) if v is not None else None)
                                    for p, v in provs_total_ars.items()}

        tasas_series = []
        for per in periodos:
            t1, t2 = idx_tasas.get((act, per, 1)), idx_tasas.get((act, per, 2))
            tasas_series.append({'periodo': per, 'pesos': t1['total'] if t1 else None,
                                  'dolares': t2['total'] if t2 else None})
        tasas_completo = all(
            idx_tasas.get((act, p, 1)) and idx_tasas.get((act, p, 2)) for p in periodos
        )
        last_per_tasas = next((p for p in reversed(periodos) if idx_tasas.get((act, p, 1)) or idx_tasas.get((act, p, 2))), last_per)
        t1l, t2l = idx_tasas.get((act, last_per_tasas, 1)), idx_tasas.get((act, last_per_tasas, 2))

        out_acts.append({
            'id': slugify(act),
            'nombre': SHORT_NAMES.get(act, act),
            'nombre_completo': act,
            'icono': ICONS.get(act, '🌱'),
            'saldos_total_completo': saldos_total_completo,
            'saldos_moneda_completo': saldos_moneda_completo,
            'tasas_completo': tasas_completo,
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

    resumen_nacional = build_resumen_nacional(periodos, out_acts)

    data = {'periodos': periodos, 'periodos_label': periodos_label,
            'provincias': PROVINCIAS, 'actividades': out_acts,
            'resumen_nacional': resumen_nacional}

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    print(f"OK: {len(out_acts)} actividades, {len(periodos)} períodos ({periodos_label[periodos[0]]} a {periodos_label[periodos[-1]]}) -> {out_path}")
    ultimo = resumen_nacional[-1]
    print(f"Tasa ponderada nacional ({periodos_label[ultimo['periodo']]}): "
          f"pesos {ultimo['tasa_pesos_ponderada']}%, dólares {ultimo['tasa_dolares_ponderada']}%")


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    build(sys.argv[2:], sys.argv[1])
