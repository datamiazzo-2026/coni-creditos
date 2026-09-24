# CONINAGRO · Créditos al agro

Dashboard estático (sin backend) con la evolución trimestral de los saldos y
tasas de crédito del sistema financiero a las actividades agroindustriales y
agropecuarias, discriminado por actividad, moneda y provincia. Pensado para
desplegarse en Netlify a partir de este repo.

**Vivo en:** se completa acá el link de Netlify una vez conectado.

## Estructura

```
index.html              página del dashboard
styles.css               estilos (tema claro, igual al de monitordegranos.com.ar)
app.js                    lógica: filtros, gráficos (Chart.js) y tablas
data/dashboard_data.json  datos que consume app.js (se regenera, no se edita a mano)
data/source/              Excel(es) originales, tal cual los entrega la fuente
scripts/build_data.py     convierte el/los Excel fuente al JSON de arriba
netlify.toml              configuración de build/deploy de Netlify
```

## Cómo están armados los datos

`scripts/build_data.py` puede leer DOS formatos de Excel fuente, y podés
pasarle varios archivos juntos (por ejemplo uno por año) para que el
dashboard muestre la serie completa combinada:

1. **Formato "limpio"** (`.xlsx`, hojas `... - SALDOS` / `... - TASAS`): ya
   viene filtrado a mano a las 12 actividades agro. Es el que se venía
   usando para 2025.
2. **Formato "crudo BCRA"** (`.xls`, hojas `Saldos` / `Tasas` /
   `Observaciones`): es el reporte SISCEN completo tal cual lo exporta el
   BCRA, con **todas** las actividades económicas del país (no solo agro),
   en una jerarquía CIIU/CLANAE. El script identifica solo a las 12
   actividades agro **por coincidencia exacta de nombre**, así que se le
   puede pasar el archivo bruto, sin filtrar antes a mano. Así se cargaron
   2023 y 2024 (`data/source/PRESTAMOS_AL_SECTOR_AGRO_2023_bcra_crudo.xls`
   y `..._2024_bcra_crudo.xls`).

En ambos formatos, cada fila es `ACTIVIDAD` × `PERIODO` (AAAAMMDD, cierre de
trimestre) × `MONEDA`, con un total nacional y el desglose por las 24
jurisdicciones (CABA + 23 provincias). La columna `MONEDA` usa esta
convención:

| moneda | significa |
|---|---|
| `0` | Total (pesos + dólares, expresado en pesos) — no existe en TASAS |
| `1` | Pesos |
| `2` | Dólares, expresado en su equivalente en pesos |

En cada fila de `SALDOS`, `moneda 1 + moneda 2 = moneda 0`. Para pasar
cualquiera de estas filas a dólares reales se divide su `TOTAL` por el
`TIPO DE CAMBIO` de esa misma fila. El dashboard hace esta cuenta para las
tres vistas de moneda del selector: **Pesos**, **Dólares** y **Total
(equivalente en US$)** — esta última es el total pesos+dólares llevado a
dólares al tipo de cambio de cada trimestre, útil para comparar entre
trimestres sin el ruido de la devaluación.

`TASAS` tiene la misma lógica pero sin moneda `0`. El valor de `TASAS` es
la tasa nacional tal cual la reporta la fuente (columna `TOTAL`) — el
dashboard no calcula ningún promedio ni ponderación propia, solo la
muestra.

### Ojo con las columnas al actualizar el Excel

**Formato limpio:** `SALDOS` tiene una columna `TIPO DE CAMBIO` entre
`MONEDA` y `TOTAL` que `TASAS` no tiene, así que el desglose por provincia
arranca en una columna distinta en cada hoja (`F` en `SALDOS`, `E` en
`TASAS`). `read_clean_sheet()` en `scripts/build_data.py` ya contempla ese
corrimiento (`total_col`/`prov_start_col`); si la fuente cambia de
estructura hay que revisar esos dos parámetros.

**Formato crudo BCRA:** es bastante más engañoso. La columna que sigue a
CABA no es la provincia de Buenos Aires en sí, sino su **total** (Gran
Buenos Aires + Resto sumados); las dos columnas siguientes son ese mismo
desglose interno de Buenos Aires, que hay que **saltear** para no contar
la provincia dos veces. El resto de las provincias sí es un bloque
contiguo en el mismo orden que `PROVINCIAS`. `read_raw_bcra_workbook()`
tiene los índices de columna ya resueltos (`saldos_prov_cols` /
`tasas_prov_cols`), pero como el BCRA podría reordenar columnas en un
export futuro, `read_raw_bcra_sheet()` valida cada columna contra el
texto de su encabezado y, para `SALDOS`, además contra que
CABA + provincias sumen el total de la fila — si alguna de las dos
validaciones falla, el script corta con un error en vez de guardar datos
corridos de provincia (así se detectó, en la versión limpia de 2025, un
bug real donde el desglose de `TASAS` por provincia venía corrido una
columna).

Otra cosa a tener en cuenta: el BCRA no siempre le pone el mismo nombre a
CABA en el encabezado — en el export de 2024 dice "CABA" y en el de 2023
dice "Capital Federal" (son la misma jurisdicción, `_validate_prov_columns`
ya contempla ambos nombres como alias). Si en un export futuro aparece
otra variante y la validación corta con error, agregar el alias nuevo a la
lista `aliases` de esa función alcanza para resolverlo.

### Actividades con serie incompleta

8 de las 12 actividades tienen todos los trimestres completos y
discriminados por moneda. Las otras 4 (granja y otros animales,
procesamiento de carnes y alimentos, elaboración de lácteos, molinería y
alimento balanceado) sí tenían desglose por moneda en 2024, pero desde 2025
la fuente solo reporta el saldo **total** (moneda 0) para ellas — no hay
pesos/dólares por separado, y en `TASAS` falta el dato en dólares.

El dashboard trata estos tres niveles de completitud por separado (campos
`saldos_total_completo`, `saldos_moneda_completo` y `tasas_completo` en el
JSON, recalculados sobre **todos** los trimestres combinados, no un número
fijo), en vez de un único flag: para estas 4 actividades muestra igual el
gráfico, las tiles y la tabla de provincia en la vista **Total (US$
equiv.)** con todos los trimestres, pero deshabilita las vistas
Pesos/Dólares (avisándolo) y muestra el aviso de dato parcial en la
pestaña Tasas. Si en el futuro vuelve a aparecer el desglose por moneda o
más trimestres de tasa, `scripts/build_data.py` los toma solos sin tocar
código.

## Actualizar con un trimestre nuevo

1. Sumá el Excel nuevo en `data/source/` (formato limpio `.xlsx` o crudo
   BCRA `.xls`, los que tengas — no hace falta filtrar el crudo a mano).
2. Corré, pasando **todos** los Excel que quieras combinar (el orden no
   importa, los períodos se ordenan solos):
   ```bash
   pip install openpyxl xlrd
   python3 scripts/build_data.py data/dashboard_data.json \
       data/source/PRESTAMOS_AL_SECTOR_AGRO_2025.xlsx \
       data/source/PRESTAMOS_AL_SECTOR_AGRO_2024_bcra_crudo.xls
   ```
   El script imprime cuántas filas leyó de cada archivo y, al final,
   cuántas actividades y trimestres quedaron en el JSON — conviene mirar
   ese resumen para confirmar que entró lo esperado.
3. Commiteá y subí los cambios — Netlify redespliega solo al detectar el
   push.

No hace falta tocar `index.html`, `styles.css` ni `app.js` para un
trimestre (o un año) nuevo: la cobertura que se ve en el encabezado y el
pie de página se calcula sola a partir de `data/dashboard_data.json`.

## Desarrollo local

Es un sitio 100% estático. Alcanza con:

```bash
python3 -m http.server 8000
```

y abrir `http://localhost:8000`.
