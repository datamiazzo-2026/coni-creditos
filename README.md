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

1. **Formato "crudo BCRA"** (`.xls`, hojas `Saldos` / `Tasas` /
   `Observaciones`): es el reporte SISCEN completo tal cual lo exporta el
   BCRA, con **todas** las actividades económicas del país (no solo agro),
   en una jerarquía CIIU/CLANAE. El script identifica solo a las 12
   actividades agro **por coincidencia exacta de nombre**, así que se le
   puede pasar el archivo bruto, sin filtrar antes a mano. Es el formato
   que se usa actualmente para **todos** los años cargados, 2015 a 2025
   (`data/source/PRESTAMOS_AL_SECTOR_AGRO_<año>_bcra_crudo.xls`).
2. **Formato "limpio"** (`.xlsx`, hojas `... - SALDOS` / `... - TASAS`):
   pensado para un Excel ya filtrado a mano a las 12 actividades agro. El
   script lo sigue soportando, pero **no se usa ningún archivo en este
   formato en el dataset actual** — el que se usaba para 2025 se reemplazó
   por el crudo BCRA equivalente (ver más abajo, "Reemplazo del Excel
   'limpio' de 2025").

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

Otra cosa rara, esta vez que NO afecta los datos: el título en inglés de la
hoja `Saldos` del export de 2017 dice "TOTAL LOANS - **PUBLIC BANKS**",
mientras que todos los demás años dicen simplemente "TOTAL LOANS". Antes de
cargar 2017 se comparó la magnitud de los saldos contra 2016 y 2018 (la
progresión es continua, sin ningún salto que sugiera un universo de datos
más chico) y se revisó la nota metodológica (1) de la hoja `Observaciones`
de ese mismo archivo, que sí aclara en español que el dato cubre "la
totalidad de las entidades financieras" — igual que en el resto de los
años. Conclusión: es un error de tipeo en la plantilla en inglés de ese
año puntual, no un cambio real de alcance, así que 2017 se cargó igual que
los demás.

### Reemplazo del Excel "limpio" de 2025

El primer archivo que se cargó para 2025 (`PRESTAMOS_AL_SECTOR_AGRO_2025.xlsx`)
era un Excel armado a mano, en formato "limpio", filtrado manualmente a las
12 actividades agro. Una auditoría completa de todo el dataset (2015-2025,
saldos y tasas, con relectura 100% independiente de cada Excel fuente y
chequeos de consistencia numérica) encontró que ese archivo tenía el
**desglose de `SALDOS` por provincia corrido de columna**: a partir de
"Corrientes" en adelante, cada provincia tenía en realidad el valor de la
provincia **dos posiciones antes** en la lista (por ejemplo, la columna
"Tierra del Fuego" tenía el valor real de "Santa Fe"). El total nacional y
toda la hoja `TASAS` (incluida tasas por provincia) no estaban afectados,
solo el desglose de `SALDOS` por provincia. El síntoma que lo delató: la
suma de las 24 provincias no coincidía con el total de la fila (fallaba en
44 de 48 filas de 2025), y provincias chicas como Tierra del Fuego, Jujuy,
Catamarca y Chaco mostraban saltos de hasta 30.000x de un trimestre a otro
mientras provincias grandes como Santa Fe, Salta o La Pampa se desplomaban
a casi cero — ambas cosas, imposibles en la realidad.

La solución fue pedir el export crudo del BCRA para 2025 (mismo formato que
2015-2024) y reemplazar el Excel limpio por
`data/source/PRESTAMOS_AL_SECTOR_AGRO_2025_bcra_crudo.xls`. Este archivo
pasó los mismos controles automáticos que los demás años (validación de
encabezados, suma de provincias = total con <1% de diferencia) y además
mostró continuidad suave con el dato de Dic-24 en las provincias que antes
tenían saltos imposibles. Como beneficio adicional, el crudo BCRA trae el
desglose completo por moneda (pesos/dólares) para las 12 actividades — el
Excel limpio solo lo tenía para 8 (ver debajo). El Excel limpio original no
se usa más en el dataset; el reemplazo se verificó con el mismo proceso de
doble control que el resto de los años.

### Actividades con serie incompleta

Actualmente **no hay ninguna** actividad con serie incompleta: las 12
actividades tienen los 44 trimestres (Mar-15 a Dic-25) completos, con
desglose por moneda en `SALDOS` y `TASAS`. Esto es así desde que se
reemplazó el Excel "limpio" de 2025 por el crudo BCRA equivalente (ver
arriba) — el archivo limpio solo traía el saldo **total** (moneda 0) para 4
de las 12 actividades (granja y otros animales, procesamiento de carnes y
alimentos, elaboración de lácteos, molinería y alimento balanceado), sin
pesos/dólares por separado ni tasa en dólares; el crudo BCRA sí trae el
desglose completo para las 12.

El dashboard igual calcula la completitud en tres niveles por separado
(campos `saldos_total_completo`, `saldos_moneda_completo` y
`tasas_completo` en el JSON, recalculados sobre **todos** los trimestres
combinados, no un número fijo) por si en el futuro una fuente nueva vuelve
a traer menos desglose que las anteriores: en ese caso el dashboard
mostraría igual el gráfico, las tiles y la tabla de provincia en la vista
**Total (US$ equiv.)** con todos los trimestres, pero deshabilitaría las
vistas Pesos/Dólares (avisándolo) y mostraría el aviso de dato parcial en
la pestaña Tasas, sin tocar código.

## Actualizar con un trimestre nuevo

1. Sumá el Excel nuevo en `data/source/` (formato limpio `.xlsx` o crudo
   BCRA `.xls`, los que tengas — no hace falta filtrar el crudo a mano).
2. Corré, pasando **todos** los Excel que quieras combinar (el orden no
   importa, los períodos se ordenan solos):
   ```bash
   pip install openpyxl xlrd
   python3 scripts/build_data.py data/dashboard_data.json \
       data/source/PRESTAMOS_AL_SECTOR_AGRO_2025_bcra_crudo.xls \
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
