#!/usr/bin/env python3
"""
Extrae, del tablero de indicadores de CONINAGRO (hoja "datos" del Excel
"CONI_tablero_indicadores_vNN.xlsx"), los precios de productor que usa el
cálculo de "saldo producto" (saldo de crédito ÷ precio del producto =
toneladas/litros/kg equivalentes), y los guarda en
data/saldo_producto_precios.json para que build_data.py los consuma.

Por qué un script separado de build_data.py: el Excel de precios es una
fuente completamente distinta (series de precios de mercado, no saldos de
crédito BCRA) y se actualiza con otra cadencia. Separarlo evita que
build_data.py dependa de openpyxl para su uso normal, y permite regenerar
solo esta parte cuando llega una versión nueva del tablero de precios, sin
tocar nada de la lógica de saldos/tasas.

Uso:
    pip install openpyxl
    python3 scripts/build_saldo_producto_precios.py \\
        data/source/CONI_tablero_indicadores_v14.xlsx \\
        data/saldo_producto_precios.json

METODOLOGÍA (ver análisis de factibilidad hecho sobre v14, Oct-2026):

- La hoja "datos" trae precios MENSUALES desde enero 2016. El tablero de
  crédito (dashboard_data.json) tiene saldos TRIMESTRALES desde mar-2015.
  Para cada trimestre del dashboard se usa el precio del ÚLTIMO MES de ese
  trimestre (ej.: 20160630 -> precio de junio 2016), no un promedio de los
  3 meses -- es la foto de precio más cercana a la foto de saldo (que
  también es un stock a fin de trimestre, no un acumulado). Antes de
  ene-2016 no hay precio de ningún producto, así que esos 4 trimestres
  (mar/jun/sep/dic-2015) quedan sin saldo_producto en TODAS las
  actividades, sin excepción.

- De las 21 actividades de crédito de CONINAGRO, se calculó saldo producto
  solo para 14. Las otras 7 quedan sin este cálculo (no hay saldo_producto
  en su configuración, y el frontend debe mostrar "no disponible"):
    * Plantas sacaríferas (azúcar): no hay NINGÚN dato de precio, costo,
      producción, exportación ni importación de azúcar/caña en todo el
      archivo (se buscó en todas las hojas). Solo aparece el nombre en la
      hoja "listas", en la lista explícita de "Otras no usadas".
    * Otros cultivos industriales, Semillas, Otros pecuarios: categorías
      genéricas sin precio propio en el archivo.
    * Servicios agrícolas, Servicios pecuarios (excepto veterinarios): son
      actividades de servicio, no de producto físico -- no existe un
      "equivalente en toneladas" conceptualmente, más allá de si hay datos.
    * Procesamiento de carnes y alimentos: decisión explícita de Ciro
      (Oct-2026) de NO incluirla -- el archivo solo tiene precios de
      hacienda viva/en pie (Bovinos, Ovinos, Porcino), no de producto
      procesado, y usar el precio del animal vivo representaría mal esta
      actividad industrial.

- En las 14 que sí se calculan, cada una usa la serie de precio que mejor
  representa el producto de la actividad, aclarado en "fuente_label" (el
  dashboard lo muestra como referencia debajo del título de la tarjeta).
  Tres de ellas tienen un desajuste de concepto conocido y aceptado
  explícitamente por Ciro:
    * Vid para vinificar -> usa precio de VINO Y MOSTO (Bolsa de Comercio
      de Mendoza), no de uva -- no existe precio de uva en el archivo
      (solo volumen de producción). Es precio de producto elaborado.
    * Elaboración de lácteos -> usa precio de LECHE CRUDA al productor
      (la misma serie que "Producción de leche"), no de producto lácteo
      elaborado -- no existe precio de queso/manteca/etc. en el archivo.
    * Hortalizas y flores -> usa precio de hortalizas únicamente (Mercado
      Central), no incluye flores (sin precio propio en el archivo).
    * Frutas y nueces -> usa precio promedio de frutas únicamente, no
      incluye nueces/frutos secos (sin precio propio en el archivo).
    * Granja y otros animales -> usa precio de aves (ponderado huevo-carne),
      que solo representa aves de corral, no otras especies menores que
      pueda incluir la categoría.
  Todas estas aclaraciones están en "fuente_label" de cada actividad en el
  JSON de salida, y el dashboard las muestra tal cual. Por pedido explícito
  de Ciro (Oct-2026) "fuente_label" es deliberadamente CORTO -- solo el
  producto y, si corresponde, el desajuste de concepto -- y NO nombra la
  bolsa/cámara/organismo que publica cada precio (eso queda documentado acá
  arriba y en los comentarios de ACT_CONFIG más abajo, no en la tarjeta).

- "Tasa producto" (Oct-2026): además de "precio_por_periodo", cada actividad
  trae "variacion_interanual_por_periodo" -- la variación del precio de ese
  producto contra el mismo trimestre un año antes. Es el insumo que usa
  build_data.py para armar la serie "tasa producto" (comparar la tasa de
  financiamiento nominal contra esta variación, para ver cuál de las dos
  creció más), una serie NUEVA e independiente de "tasa real" (que sigue
  deflactando por inflación general/IPC, sin cambios). Al ser interanual,
  no hace falta ninguna extracción adicional del Excel: alcanza con el
  mismo precio_por_periodo ya calculado arriba, comparando cada trimestre
  contra el mismo trimestre del año anterior (periodo - 10000). Por el
  mismo motivo, los 4 trimestres de 2016 quedan sin variación interanual en
  todas las actividades (no hay precio de 2015 contra el que comparar).

- "Cereales, oleaginosas y forrajeras" es la única actividad cuyo precio
  se calcula en DÓLARES (promedio de cebada/girasol/maíz/soja/sorgo/trigo,
  que cotizan en u$s/t en el archivo) -- por eso usa moneda="usd" y
  saldo_field="total_usd" en vez de "total_ars": así se evita convertir el
  precio a pesos a mano (con qué tipo de cambio, de qué día del trimestre)
  y se aprovecha que el dashboard ya tiene el saldo de cada actividad
  convertido a dólares por trimestre. El resto de las actividades cotiza
  en pesos y usa moneda="ars" / saldo_field="total_ars" (saldo nominal
  corriente, no en pesos constantes -- dividir un saldo ajustado por
  inflación por un precio nominal no tendría sentido).
"""
import sys
import json
import datetime
from pathlib import Path

# columna (1-based) en la hoja "datos" del Excel de precios, para cada
# serie de precio cruda que se necesita. Confirmado a mano contra la fila
# de encabezados jerárquicos (filas 3-8) de la hoja "datos" de v14.
COLS = {
    'cebada': 19, 'girasol': 20, 'maiz': 21, 'soja': 22, 'sorgo': 23, 'trigo': 24,
    'algodon_promedio': 16,
    'tabaco_acopio_fet': 62,
    'bovinos_promedio': 65,
    'ovinos_promedio': 73,
    'porcino_capon': 70,
    'leche_promedio': 66,
    'forestacion_promedio': 59,
    'hortalizas_mayorista': 54,
    'manzana': 40, 'pera': 41, 'limon': 43, 'mandarina': 44, 'naranja': 45, 'pomelo': 46,
    'aves_promedio': 69,
    'harina_trigo': 347,
    'vino_y_mosto': 39,
}

# actividad (id = slug, igual al que genera slugify() en build_data.py) ->
# configuración de qué columnas usar y cómo combinarlas.
ACT_CONFIG = {
    # fuente: promedio de cebada/girasol/maíz/soja/sorgo/trigo, cotizan en
    # u$s/t (MATba-Rofex/BCR/SAGyP/BCBB) -- ver nota de moneda=usd arriba.
    'cereales-oleaginosas-y-forraje': {
        'componentes': ['cebada', 'girasol', 'maiz', 'soja', 'sorgo', 'trigo'],
        'moneda': 'usd', 'saldo_field': 'total_usd', 'unidad': 't',
        'fuente_label': 'Promedio de cereales y oleaginosas',
    },
    # fuente: SAGyP, precio promedio de algodón al mercado interno.
    'plantas-para-la-obtencion-de-f': {
        'componentes': ['algodon_promedio'],
        'moneda': 'ars', 'saldo_field': 'total_ars', 'unidad': 'kg',
        'fuente_label': 'Precio de algodón',
    },
    # fuente: Cámara del Tabaco / SAGyP, Virginia Acopio+FET, Salta.
    'tabaco': {
        'componentes': ['tabaco_acopio_fet'],
        'moneda': 'ars', 'saldo_field': 'total_ars', 'unidad': 'kg',
        'fuente_label': 'Precio de tabaco',
    },
    # fuente: Mercado de Liniers, precio promedio bovinos.
    'bovino-excepto-en-cabanas-y-pa': {
        'componentes': ['bovinos_promedio'],
        'moneda': 'ars', 'saldo_field': 'total_ars', 'unidad': 'kg',
        'fuente_label': 'Precio de hacienda bovina',
    },
    # fuente: SIPAN/INTA, categoría 12C+3,5L.
    'ovino-excepto-en-cabanas-y-par': {
        'componentes': ['ovinos_promedio'],
        'moneda': 'ars', 'saldo_field': 'total_ars', 'unidad': 'kg',
        'fuente_label': 'Precio de hacienda ovina',
    },
    # fuente: SAGyP, Capón General (informes de precios porcinos).
    'porcino-excepto-en-cabanas': {
        'componentes': ['porcino_capon'],
        'moneda': 'ars', 'saldo_field': 'total_ars', 'unidad': 'kg',
        'fuente_label': 'Precio de hacienda porcina',
    },
    # fuente: SIGLeA/SAGyP, precio al productor.
    'produccion-de-leche-incluye-la': {
        'componentes': ['leche_promedio'],
        'moneda': 'ars', 'saldo_field': 'total_ars', 'unidad': 'l',
        'fuente_label': 'Precio de leche cruda',
    },
    # fuente: Instituto Forestal Misiones / INTA Concordia, pino y eucalipto.
    'madera': {
        'componentes': ['forestacion_promedio'],
        'moneda': 'ars', 'saldo_field': 'total_ars', 'unidad': 't',
        'fuente_label': 'Precio de madera',
    },
    # fuente: Mercado Central, precio mayorista de hortalizas.
    'hortalizas-legumbres-flores-y-': {
        'componentes': ['hortalizas_mayorista'],
        'moneda': 'ars', 'saldo_field': 'total_ars', 'unidad': 'kg',
        'fuente_label': 'Precio de hortalizas, no incluye flores',
    },
    # fuente: Mercado Central, promedio de manzana/pera/limón/mandarina/naranja/pomelo.
    'frutas-excepto-vid-para-vinifi': {
        'componentes': ['manzana', 'pera', 'limon', 'mandarina', 'naranja', 'pomelo'],
        'moneda': 'ars', 'saldo_field': 'total_ars', 'unidad': 'caja de 18kg',
        'fuente_label': 'Precio de frutas, no incluye nueces',
    },
    # fuente: Cátedra Avícola, ponderado huevo-carne.
    'produccion-de-granja-y-cria-de': {
        'componentes': ['aves_promedio'],
        'moneda': 'ars', 'saldo_field': 'total_ars', 'unidad': 'kg',
        'fuente_label': 'Precio de aves, no otras especies de granja',
    },
    # fuente: INDEC, harina de trigo al consumidor.
    'elaboracion-de-productos-de-mo': {
        'componentes': ['harina_trigo'],
        'moneda': 'ars', 'saldo_field': 'total_ars', 'unidad': 'kg',
        'fuente_label': 'Precio de harina, no alimento balanceado',
    },
    # fuente: Bolsa de Comercio de Mendoza, vino y mosto (no hay precio de uva).
    'vid-para-vinificar': {
        'componentes': ['vino_y_mosto'],
        'moneda': 'ars', 'saldo_field': 'total_ars', 'unidad': 'l',
        'fuente_label': 'Precio de vino y mosto, no de uva',
    },
    # fuente: SIGLeA/SAGyP, misma serie que "Producción de leche" (leche cruda).
    'elaboracion-de-productos-lacte': {
        'componentes': ['leche_promedio'],
        'moneda': 'ars', 'saldo_field': 'total_ars', 'unidad': 'l',
        'fuente_label': 'Precio de leche cruda, no elaborado',
    },
}

# Trimestres del dashboard (deben coincidir con los que arma build_data.py;
# se listan a mano porque este script corre independiente y no abre los
# .xls crudos del BCRA). Si el dashboard agrega trimestres nuevos, hay que
# sumarlos aquí también.
PERIODOS = [
    20150331, 20150630, 20150930, 20151231,
    20160331, 20160630, 20160930, 20161231,
    20170331, 20170630, 20170930, 20171231,
    20180331, 20180630, 20180930, 20181231,
    20190331, 20190630, 20190930, 20191231,
    20200331, 20200630, 20200930, 20201231,
    20210331, 20210630, 20210930, 20211231,
    20220331, 20220630, 20220930, 20221231,
    20230331, 20230630, 20230930, 20231231,
    20240331, 20240630, 20240930, 20241231,
    20250331, 20250630, 20250930, 20251231,
    20260331, 20260630,
]


def extract_monthly(xlsx_path):
    import openpyxl
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb['datos']
    rows = list(ws.iter_rows(min_row=9, max_row=ws.max_row))
    dated_rows = [r for r in rows if isinstance(r[0].value, datetime.datetime)]

    by_month = {}
    for r in dated_rows:
        d = r[0].value
        key = f"{d.year:04d}-{d.month:02d}"
        vals = {}
        for name, col in COLS.items():
            v = r[col - 1].value
            vals[name] = v if isinstance(v, (int, float)) else None
        by_month[key] = vals
    return by_month


# Las 7 actividades de crédito de CONINAGRO que quedan SIN saldo producto,
# con el motivo puntual de cada una (el dashboard lo muestra en vez de un
# "no disponible" genérico -- ver docstring del módulo para el detalle de
# la investigación detrás de cada motivo).
MOTIVOS_NO_DISPONIBLE = {
    'plantas-sacariferas':
        'sin dato de precio de azúcar/caña',
    'otros-cultivos-industriales':
        'categoría genérica, sin precio propio',
    'produccion-de-semillas-y-otras':
        'sin precio de semilla diferenciado del grano',
    'otros-pecuarios':
        'categoría genérica, sin precio propio',
    'servicios-agricolas':
        'es un servicio, no un producto físico',
    'servicios-pecuarios-excepto-lo':
        'es un servicio, no un producto físico',
    'produccion-y-procesamiento-de-':
        'solo hay precio de hacienda viva, no procesada',
}


def build(xlsx_path, out_path):
    by_month = extract_monthly(xlsx_path)

    precios_por_periodo = {}
    for p in PERIODOS:
        y, m = p // 10000, (p // 100) % 100
        precios_por_periodo[p] = by_month.get(f"{y:04d}-{m:02d}", {})

    out = {}
    for act_id, cfg in ACT_CONFIG.items():
        serie = {}
        for p in PERIODOS:
            vals = precios_por_periodo[p]
            comps = [vals.get(c) for c in cfg['componentes']]
            comps_present = [c for c in comps if c is not None]
            if len(comps_present) == len(cfg['componentes']) and comps_present:
                precio = sum(comps_present) / len(comps_present)
            else:
                precio = None
            serie[str(p)] = precio

        # "Tasa producto" (Oct-2026): variación INTERANUAL del precio del
        # producto (mismo trimestre, un año antes), para comparar contra la
        # tasa de financiamiento nominal y ver cuál de las dos creció más.
        # Ciro eligió interanual en vez de ventana centrada de 12 meses (la
        # que usa la inflación general/IPC para la tasa real) justamente
        # para no perder cobertura en los trimestres más recientes -- acá no
        # hay un equivalente a la proyección REM del IPC, así que una
        # ventana centrada dejaría sin dato a los últimos 1-2 trimestres de
        # la serie. El costo de esta elección: como el precio del producto
        # arranca en ene-2016, los 4 trimestres de 2016 quedan sin variación
        # interanual en TODAS las actividades (no hay precio de 2015 contra
        # el que comparar), no solo los de 2015 (que ya quedaban sin saldo
        # producto por el motivo explicado arriba).
        variacion_interanual = {}
        for p in PERIODOS:
            precio_actual = serie.get(str(p))
            precio_anterior = serie.get(str(p - 10000))
            if precio_actual is not None and precio_anterior:
                variacion_interanual[str(p)] = round((precio_actual / precio_anterior - 1) * 100, 4)
            else:
                variacion_interanual[str(p)] = None

        out[act_id] = {
            'moneda': cfg['moneda'],
            'saldo_field': cfg['saldo_field'],
            'unidad': cfg['unidad'],
            'fuente_label': cfg['fuente_label'],
            'precio_por_periodo': serie,
            'variacion_interanual_por_periodo': variacion_interanual,
        }

    out['_no_disponibles'] = MOTIVOS_NO_DISPONIBLE

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"OK: {len(out) - 1} actividades con precio -> {out_path}")
    for act_id, d in out.items():
        if act_id == '_no_disponibles':
            continue
        n = sum(1 for v in d['precio_por_periodo'].values() if v is not None)
        n_var = sum(1 for v in d['variacion_interanual_por_periodo'].values() if v is not None)
        print(f"  {act_id}: {n}/{len(PERIODOS)} períodos con precio, {n_var}/{len(PERIODOS)} con variación interanual")
    print(f"  (+ {len(MOTIVOS_NO_DISPONIBLE)} actividades sin saldo producto, con motivo)")


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    build(sys.argv[1], sys.argv[2])
