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
   en una jerarquía CIIU/CLANAE. El script identifica las 21 actividades
   agro/agroindustriales (ver "Actividades agro agregadas en Oct-2026" más
   abajo) **por su número de Orden BCRA**, así que se le puede pasar el
   archivo bruto, sin filtrar antes a mano. Es el formato que se usa
   actualmente para **todos** los años cargados, 2015 a 2026
   (`data/source/PRESTAMOS_AL_SECTOR_AGRO_<año>_bcra_crudo.xls`).
2. **Formato "limpio"** (`.xlsx`, hojas `... - SALDOS` / `... - TASAS`):
   pensado para un Excel ya filtrado a mano a un subconjunto fijo de
   actividades agro. El script lo sigue soportando, pero **no se usa
   ningún archivo en este formato en el dataset actual** — el que se usaba
   para 2025 se reemplazó por el crudo BCRA equivalente (ver más abajo,
   "Reemplazo del Excel 'limpio' de 2025"). Si se vuelve a usar este
   formato, ojo: solo sabe leer la actividad tal cual viene en la columna A
   del Excel, no tiene el mecanismo de Orden/agrupación que sí tiene el
   crudo BCRA (ver más abajo) -- un Excel limpio con las actividades
   agrupadas (Tabaco, Madera, Otros pecuarios) tendría que traerlas ya
   sumadas a mano.

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

### ⚠️ Corrección: los montos de SALDOS venían en miles de pesos

Hasta que se corrigió, `build_data.py` tomaba la columna `TOTAL` de
`SALDOS` (y el desglose por provincia) como si estuviera en pesos. En
realidad, la hoja `Saldos` del crudo BCRA la declara explícitamente en su
título: **"TOTAL LOANS - Balances in thousands pesos (1)"** — está en
**miles de pesos**, igual en los 12 archivos fuente (2015 a 2026). El
resultado: todos los montos del dashboard (tiles de saldo, gráfico de
evolución, mapa y ranking por provincia) se mostraban **1.000 veces más
chicos** que el valor real.

Se detectó comparando el total nacional de crédito agro que calcula este
dashboard contra el que publica CONINAGRO en su propio informe: para
Jun-26, acá daba US$ 12,3 *millones* contra los US$ 12.303 *millones* que
publica CONINAGRO para ese mismo trimestre — una diferencia de exactamente
tres ceros. Ningún chequeo interno lo detectaba porque ninguno mira la
magnitud absoluta: `check_sum` valida que las provincias sumen el total de
su fila (una razón entre magnitudes, no un valor absoluto) y la validación
de tipo de cambio compara TCs entre actividades del mismo trimestre — un
factor de escala aplicado por igual a *todos* los montos pasa ambos
chequeos sin problema.

**Corrección**: `read_raw_bcra_sheet()` ahora multiplica por 1000 el
`TOTAL` y el desglose por provincia de `SALDOS` (`unit_multiplier=1000`),
validando primero que la leyenda "thousands"/"miles" siga apareciendo en
las primeras filas de la hoja (`_validate_units_label`) — así, si el BCRA
cambia de unidad en un export futuro, el script frena con un error en vez
de repetir el mismo error en silencio. `TASAS` no se toca (son tasas en %,
no hay unidad que corregir) y las tasas ponderadas de la pestaña Resumen
tampoco cambiaron (son un promedio ponderado por saldo: multiplicar todos
los pesos por la misma constante no cambia el resultado).

`dashboard_data.json` se regeneró con la corrección y se volvió a validar
contra los Excel fuente de punta a punta (provincias que suman el total en
las 552 combinaciones actividad×trimestre con dato, `pesos + dólares×TC =
total` en las mismas 552, y el total nacional recalculado independientemente
con pandas para los 46 trimestres) antes de subirlo.

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

Las 21 actividades (ver más abajo) tienen saldo completo: los 46 trimestres
(Mar-15 a Jun-26), con desglose por moneda en `SALDOS`
(`saldos_total_completo` y `saldos_moneda_completo` en `True` para las 21).
`tasas_completo` sí varía entre actividades -- no todas tienen tasa en
pesos Y en dólares en los 46 trimestres (algunas chicas directamente no
tuvieron crédito en dólares algún trimestre puntual), lo cual es normal y
no afecta saldos ni el resto de la vista; la pestaña Tasas avisa con un
punto junto al nombre de la actividad en la barra lateral cuando pasa esto.

El dashboard calcula la completitud en tres niveles por separado (campos
`saldos_total_completo`, `saldos_moneda_completo` y `tasas_completo` en el
JSON, recalculados sobre **todos** los trimestres combinados, no un número
fijo) por si en el futuro una fuente nueva trae menos desglose que las
anteriores: en ese caso el dashboard mostraría igual el gráfico, las tiles
y la tabla de provincia en la vista **Total (US$ equiv.)** con todos los
trimestres, pero deshabilitaría las vistas Pesos/Dólares (avisándolo) y
mostraría el aviso de dato parcial en la pestaña Tasas, sin tocar código.

### Actividades agro agregadas en Oct-2026

Hasta Sep-2026 el dashboard mostraba las 12 actividades que CONINAGRO
define en su propio informe. A pedido de Ciro se sumaron 9 actividades
agro/agroindustriales más, tomadas del mismo árbol CIIU/CLANAE del crudo
BCRA que ya se leía -- no hizo falta ningún dato nuevo, solo ampliar qué
ramas del árbol lee el script. Quedaron **21 actividades** en total:

- **6 nuevas, cada una su propia tarjeta**: Hortalizas/legumbres/flores,
  Plantas para la obtención de fibras (algodón, entre otras), Plantas
  sacaríferas (caña de azúcar, remolacha, entre otras), Otros cultivos
  industriales, Producción de semillas, Servicios agrícolas, y Servicios
  pecuarios (excepto los veterinarios).
- **2 actividades agrupadas** (suman más de una rama del árbol BCRA en una
  sola tarjeta):
  - **"Otros pecuarios"**: todo lo que queda de "Cría de ganado y
    producción de leche, lana y pelos" afuera de Bovino, Ovino, Porcino y
    Producción de leche (que ya eran tarjetas propias) -- Equino, Caprino,
    "En cabañas y haras", Producción de lana y pelos, y el "Otros" de esa
    categoría puntual. Leche queda afuera de este grupo a propósito
    (confirmado con Ciro): sigue siendo su propia tarjeta, no se duplica.
  - **"Madera"**: Silvicultura/extracción de madera (sector primario) +
    Producción de madera y fabricación de productos de madera y corcho
    (industria) -- dos ramas en categorías de primer nivel distintas del
    árbol BCRA (agricultura/ganadería/silvicultura vs. industria
    manufacturera), unificadas en una tarjeta porque económicamente son la
    misma cadena de valor.
- **1 actividad existente ampliada**: **Tabaco** pasó a sumar Elaboración
  de productos de tabaco (industria) a lo que ya tenía (el cultivo). La
  tarjeta Tabaco de antes de Oct-2026 solo medía el cultivo; desde esta
  actualización mide cultivo + industria combinados, así que su saldo creció
  fuertemente de un trimestre al otro -- no es un error, es el cambio de
  alcance. El campo `nombre_completo` del JSON lo aclara explícitamente
  ("Tabaco (cultivo + elaboración de productos de tabaco)").

**Identificación por Orden BCRA, no por nombre de texto**: hasta esta
expansión, `build_data.py` identificaba cada actividad por coincidencia
EXACTA de su nombre de texto. Eso dejó de alcanzar al querer agregar
"Otros pecuarios": el BCRA reutiliza literalmente la palabra "Otros" en 5
lugares distintos del árbol (ganadería, minería, industria, inmobiliaria,
servicios) -- matchear por texto ahí mezclaría en silencio datos de
categorías sin ninguna relación entre sí. La solución fue identificar cada
actividad por su número de "Orden" BCRA (columna A de las hojas crudas),
que es la clave real y unívoca de cada fila del árbol, y que verificamos
estable en los 12 archivos fuente (2015-2026). `ORDEN_LABELS` +
`_validate_orden_labels()` en `build_data.py` confirman en cada archivo que
el texto de esa fila siga siendo el esperado para ese Orden antes de
confiar en el número -- mismo patrón defensivo que ya usaban
`_validate_units_label()` y `_validate_prov_columns()` para el bug de
unidad y el de columnas de provincia (ver más arriba).

**Cómo se suman las actividades agrupadas**: los SALDOS de un grupo (ej.
Tabaco = cultivo + industria) se suman directo, provincia por provincia.
Las TASAS se promedian ponderando por el saldo de cada sub-actividad en
esa misma moneda y período (mismo criterio que la tasa ponderada nacional
de la pestaña Resumen) -- nunca una suma ni un promedio simple, porque el
peso de crédito de cada sub-actividad agrupada puede ser muy distinto (la
industria del tabaco pesa bastante más que el cultivo, por ejemplo). Ver
`_merge_saldo_group()` / `_merge_tasa_group()` en `build_data.py`.

**Validado de punta a punta**, con el mismo rigor que la corrección de
unidad de Sep-2026: recálculo 100% independiente en pandas (sin reusar
ninguna función de `build_data.py`) de saldos, desglose por provincia y
tasas ponderadas para las 9 actividades nuevas/agrupadas, en los 46
trimestres -- 0 diferencias contra `dashboard_data.json` (fuera de
redondeos de ±1 peso esperables por sumar en distinto orden). También se
confirmó que las 11 actividades que NO cambiaron (todas las originales
menos Tabaco) dieran EXACTAMENTE los mismos números que antes de este
cambio (0 diferencias en saldos, tasas y desglose por provincia), y que
`pesos + dólares×TC = total` siga cumpliéndose para las 21 actividades
(966 filas chequeadas, 0 diferencias).

**Impacto en "Participación en el crédito agro" y en el total nacional**:
al sumar más actividades, el total nacional (`total_ars_nacional`) creció
~28% (de ~$18,2 billones a ~$23,3 billones en Jun-26), así que la
participación de CADA actividad (incluidas las 12 originales) se
recalculó contra ese total más grande -- por ejemplo, Cereales pasó de
~41% a ~32% del crédito agro total en Jun-26. Es el resultado esperado de
ampliar el universo de actividades, no un error; el cálculo en sí
(`act.total_ars / resumen_nacional.total_ars_nacional`) no cambió.

**Importante -- ya no es comparable 1 a 1 contra el informe de CONINAGRO**:
el total nacional de este dashboard, a partir de esta expansión, mide más
actividades de las que cubre el informe de CONINAGRO (que sigue centrado
en sus 12 actividades originales), así que la validación cruzada que se
hizo en Sep-2026 (0,005% de diferencia para Jun-26, ver sección de Resumen
más abajo) **dejó de aplicar en estos términos**: a partir de ahora
nuestro total va a ser estructuralmente mayor que el de CONINAGRO, a
propósito. Si en el futuro se quiere seguir validando contra su informe,
hay que sumar solo las 12 actividades originales antes de comparar, no el
total de las 21 -- la tasa ponderada nacional (pestaña Resumen) también se
recalculó sobre las 21, así que tampoco es directamente comparable contra
el número que publica CONINAGRO sin hacer el mismo recorte.

**Chequeo de consistencia por provincia, con piso absoluto nuevo**: al
agregar actividades chicas y de nicho (ej. Caprino) aparecieron 2 de 3677
filas donde las provincias no suman exacto el total de la columna, pero
con un total de apenas $17.000-31.000 -- montos irrelevantes a la escala
del dashboard (miles de millones), muy probablemente redondeo o
enmascaramiento estadístico del BCRA en celdas chicas, no un error de
columna (ya validado por separado que el mapeo de columnas y de Orden es
correcto en esas mismas filas). Se agregó un piso absoluto de $1.000.000 a
`check_sum`: ahora solo frena si la diferencia es grande en términos
relativos (>1%) Y TAMBIÉN en términos absolutos (>$1.000.000) -- una
columna de provincia realmente mal mapeada seguiría desalineando TODAS las
filas de esa columna con diferencias absolutas mucho mayores, así que el
piso no tapa ese caso.

## Pestaña "Resumen": tasa ponderada, diferencial y pesos vs. dólares

A partir del informe "Crédito al sector agropecuario" que CONINAGRO publica
cada semestre, se sumó una tercera pestaña con tres vistas a nivel nacional
(no por actividad):

1. **Tasa ponderada nacional**: el promedio de la tasa de cada actividad,
   ponderado por el peso de esa actividad sobre el saldo total *de esa
   misma moneda* en el trimestre (pesos pondera con saldo en pesos,
   dólares con saldo en dólares — no es la misma ponderación, porque la
   composición por moneda no es igual en cada actividad). Se calcula en
   `build_resumen_nacional()` (`scripts/build_data.py`) y queda en
   `resumen_nacional` en el JSON, no se recalcula en el navegador.
   Metodología validada contra el propio informe de CONINAGRO: para Jun-25
   (el único trimestre que compartimos con su informe de Jun-26), la tasa
   ponderada en pesos que da nuestra cuenta es 48,95%-49,0% según la base
   de ponderación exacta que se use (se probaron tres: saldo en pesos,
   saldo total en pesos, saldo total en dólares — las tres coinciden entre
   sí a menos de 0,1 punto), contra el 49,3% que publica CONINAGRO. La
   pequeña diferencia (~0,3 puntos) es esperable por redondeos y por cómo
   corta cada uno el dato; se considera una validación exitosa. El dashboard
   muestra esta comparación en la propia vista, para que quede a la vista
   si alguna vez se desalinea.

   **Pendiente/a monitorear**: para Jun-26 (el trimestre más reciente),
   CONINAGRO publica 52,4% en pesos y 5,7% en dólares; este dashboard
   calcula 47,3% y 5,0% respectivamente -- una diferencia de ~5 puntos en
   pesos y ~0,7 puntos en dólares, bastante mayor que la de Jun-25. La
   metodología de ponderación es la misma que ya validó bien contra Jun-25,
   así que no parece un error propio; es más probable que la fuente de
   CONINAGRO para Jun-26 use un corte de datos distinto (más entidades
   informantes, un mes de cierre distinto dentro del trimestre, etc.). En
   cambio, el **total nacional de crédito** (no la tasa) sí validó
   perfecto con el alcance de 12 actividades vigente hasta Sep-2026: para
   Jun-26 daba US$ 12.303,6 millones contra los US$ 12.303 millones que
   publica CONINAGRO -- una diferencia de 0,005%. **Desde que se agregaron
   9 actividades más en Oct-2026 (ver "Actividades agro agregadas en
   Oct-2026" más arriba), esta comparación ya no aplica tal cual**: el
   total de acá pasó a medir más actividades de las que cubre el informe
   de CONINAGRO, así que es estructuralmente mayor a propósito. Si se
   quiere seguir validando contra el informe de CONINAGRO hay que sumar
   solo las 12 actividades originales antes de comparar.
2. **Diferencial de cada actividad vs. el promedio ponderado**: se calcula
   en el navegador (resta simple, `app.js`), no hace falta guardarlo en el
   JSON. Usa como referencia el trimestre que está en el extremo derecho
   del slider de ventana de tiempo (ver debajo), no siempre el último dato
   publicado.
3. **Costo efectivo: crédito en dólares vs. en pesos**: combina la tasa
   ponderada en dólares con la devaluación interanual (4 trimestres) del
   tipo de cambio, para poder comparar el costo de un crédito en dólares
   contra uno en pesos en igualdad de condiciones — la misma cuenta que
   hace CONINAGRO en su informe, pero calculada para toda la serie
   histórica en vez de un solo período. No hay dato en los primeros 4
   trimestres (2015) porque no hay tipo de cambio de "hace un año" contra
   el cual compararlos.

`build_resumen_nacional()` también valida que el tipo de cambio de la
columna `TC` sea el mismo para todas las actividades de un mismo trimestre
(tiene que serlo, es el TC oficial nacional) y corta con un error si no
-- la misma filosofía de "frenar antes que guardar un dato mal calculado"
que ya usa el resto del script.

## Slider de ventana de tiempo

El control "Ventana de tiempo", debajo del gráfico principal de cada
pestaña, filtra qué trimestres se ven en todos los gráficos (Saldos, Tasas
y Resumen). También recalcula, en vivo, todo lo que depende de "qué
trimestre estamos mirando": la tile "Variación del período" (compara el
extremo izquierdo del slider contra el derecho, no siempre Mar-15 contra
el último dato), la tile "Mix por moneda" (promedio ponderado por saldo de
todos los trimestres visibles, no solo el último), la tile "Participación
en el crédito agro" y las cuatro tiles de la pestaña Tasas (ver más
abajo), el mapa + ranking por provincia de Saldos y de Tasas (ver más
abajo) y, en la pestaña Resumen, las tres tiles de tasa/costo efectivo y
el trimestre de referencia del gráfico de diferencial. Todos estos usan
el extremo **derecho** de la ventana elegida (`state.rangeEnd`) como "el
trimestre actual" -- si el slider está en su posición default (todo el
rango), coincide con el último dato disponible; si se lo acota, por
ejemplo hasta Mar-25, todos esos elementos pasan a mostrar Mar-25. Es
100% client-side (`app.js`), no requiere tocar el JSON. Un mismo
`<div class="rangepanel">` se reubica entre pestañas con
`moveRangeSlider()` (`appendChild` a `#rangeSlot-<tab>`) en vez de
duplicarse.

## Tarjetas (tiles) de Saldos y Tasas

**Saldos** (`renderTiles()`): la cuarta tile, antes "Cobertura de datos"
(cuántos de los 46 trimestres tenían dato -- un número que no decía mucho
sobre la actividad en sí), ahora es **"Participación en el crédito agro"**:
qué porcentaje del saldo total agropecuario (las `DATA.actividades.length`
actividades combinadas -- 21 desde Oct-2026, ver "Actividades agro
agregadas en Oct-2026" más arriba -- `resumen_nacional[i].total_ars_nacional`)
representa el saldo total de la actividad elegida, en el trimestre del
extremo derecho de la ventana elegida. `resumen_nacional` está alineado 1
a 1 por índice con `periodos`/`series`, así que se indexa con el mismo
`state.rangeEnd` que el resto de las tiles. A diferencia de cobertura (un
dato sobre la calidad de la serie), esta tile conecta la actividad puntual
con el panorama general -- p. ej. Cereales/oleaginosas/forraje pesa ~32%
del crédito agro total en Jun-26 (bajó de ~41% al sumar más actividades
al total, ver sección de arriba), mientras que Tabaco (ahora cultivo +
industria combinados) pesa ~0,9%.

**Tasas** (`renderTasaTiles()`, nuevo): cuatro tiles arriba del gráfico
"Tasa nacional por trimestre", todas de la actividad elegida en el
trimestre del extremo derecho de la ventana:

- Tasa nacional en pesos y tasa nacional en dólares del trimestre actual
  (`act.tasas[state.rangeEnd]`).
- Variación de la tasa en pesos y en dólares **contra el trimestre
  inmediato anterior** (`act.tasas[state.rangeEnd-1]`) -- a diferencia de
  la tile "Variación del período" de Saldos, que compara contra el
  extremo izquierdo de la ventana, acá siempre es trimestre a trimestre,
  independientemente de dónde esté el otro extremo del slider. Si no hay
  dato en el trimestre anterior (por ejemplo, en el primer trimestre de
  toda la serie) la tile muestra "--" en vez de una variación inventada.
  Una suba de tasa se marca en rojo (crédito más caro) y una baja en
  verde, mismo criterio de color que la tile "Costo efectivo" de Resumen.

## Gráfico histórico de participación (Saldos, Oct-2026)

Debajo del gráfico "Evolución trimestral del saldo" (pestaña Saldos) hay un
segundo gráfico de línea, "Participación histórica en el crédito agro"
(`renderParticipChart()`, canvas `#participChart`): muestra, para cada
trimestre de la ventana de tiempo elegida, qué porcentaje del crédito agro
total representa la actividad seleccionada. A diferencia de la tile
"Participación en el crédito agro" (que es un único número, siempre en
"total equivalente en US$", del trimestre del extremo derecho de la
ventana -- ver sección anterior), este gráfico es una serie completa y
**depende de la moneda elegida arriba** (`#curSeg`: Total / Pesos /
Dólares), a pedido explícito de CONINAGRO:

- **Total**: `act.series[i].total_ars / resumen_nacional[i].total_ars_nacional`
  -- mismo cálculo que ya usaba la tile, extendido a toda la serie.
- **Pesos**: `act.series[i].pesos_ars / resumen_nacional[i].pesos_ars_nacional`.
- **Dólares**: `act.series[i].dolares_usd / resumen_nacional[i].dolares_usd_nacional`.

Los denominadores `pesos_ars_nacional` y `dolares_usd_nacional` son
campos nuevos en `resumen_nacional` (uno por trimestre, junto al ya
existente `total_ars_nacional`), calculados en
`build_resumen_nacional()` (`scripts/build_data.py`): la suma de
`pesos_ars`/`dolares_usd` de las 21 actividades en ese trimestre, mismo
criterio que ya usaba `total_ars_nacional` (lo no reportado por una
actividad se trata como ausente, no como cero). Se eligió calcularlos en
Python y guardarlos en el JSON -- en vez de sumarlos en el navegador en
cada render -- para que el denominador de cada moneda se audite con el
mismo rigor que el resto de `resumen_nacional` y quede disponible para
cualquier otro uso futuro sin duplicar la lógica en `app.js`.

**Verificación**: se comprobó, para los tres modos de moneda y los 46
trimestres, que (a) sumar la participación de las 21 actividades da
exactamente 100% en cada trimestre con dato, y (b) una recomputación
independiente en Python -- sumando `pesos_ars`/`dolares_usd` directamente
desde `actividades[].series`, sin reusar el código de `build_data.py` --
coincide con `pesos_ars_nacional`/`dolares_usd_nacional` en los 46
trimestres, sin excepciones. También se verificó en el navegador (vía
Playwright) que los valores que efectivamente grafica Chart.js coinciden
con un cálculo manual sobre el JSON para varias combinaciones de
actividad/moneda.

El gráfico respeta el slider de ventana de tiempo (igual que el resto de
la vista Saldos) y se vuelve a dibujar tanto al cambiar de actividad como
al cambiar de moneda o de ventana.

## Gráfico histórico de mix de monedas (Saldos, Oct-2026)

Debajo del gráfico de participación hay un tercer gráfico de línea, "Mix
de monedas en el tiempo" (`renderMixChart()`, canvas `#mixChart`): para
cada trimestre de la ventana elegida, qué parte del saldo **de la
actividad seleccionada** (no del crédito agro total -- eso lo cubre el
gráfico de participación) está en pesos y qué parte está en dólares. Es
la versión histórica, trimestre a trimestre, de la tile "Mix por moneda"
(que sigue existiendo tal cual estaba: un único número agregado sobre
toda la ventana elegida -- se mantuvieron las dos cosas, mismo criterio
que ya se usó con la tile "Participación en el crédito agro" y su
gráfico histórico).

A diferencia del resto de la vista Saldos, este gráfico **no depende**
del selector de moneda (`#curSeg`): mostrar "el mix entre pesos y
dólares" fijado a una sola moneda no tendría sentido, así que siempre
muestra las dos series juntas.

- **% en pesos** = `pesos_ars / total_ars`.
- **% en dólares** = `(dolares_usd * tc) / total_ars` -- el dólar se lleva
  a su equivalente en pesos con el tipo de cambio de ESE mismo trimestre
  antes de sacar el porcentaje, para que ambas series sumen ~100% del
  saldo de la actividad (se apoya en que `total_ars = pesos_ars +
  dolares_usd * tc`, identidad ya verificada en todo el dataset -- ver
  más abajo).

**Verificación**: se comprobó para las 21 actividades que
`pesos_ars + dolares_usd*tc` reconstruye `total_ars` con un error relativo
máximo de ~3,6×10⁻⁶% (redondeo de centavos, no un error real), y en el
navegador (vía Playwright) que los valores que efectivamente grafica
Chart.js para una actividad de prueba, en los 46 trimestres, coinciden
con el cálculo manual sobre el JSON, y que ambas series suman ~100% en
todos los puntos con dato.

## Orden alfabético del listado de actividades (Oct-2026)

El listado de actividades de la izquierda (`#actSidebar`, pestaña Saldos
y Tasas) se muestra ordenado alfabéticamente (`a.nombre.localeCompare(b,
'es', {sensitivity:'base'})`), a pedido de CONINAGRO -- antes seguía el
orden de `DATA.actividades`, agrupado por rubro (agrícola, pecuario,
agroindustrial), que no era obvio para quien no conoce esa clasificación.

Importante: solo cambia el ORDEN VISUAL del listado. `renderPills()`
arma una copia ordenada (`ACTIVIDADES_ALFABETICO`) y nunca reordena
`DATA.actividades` -- el resto del dashboard (la actividad seleccionada
por default, el orden en que se procesan los datos, etc.) no se ve
afectado.

## Tasa real en pesos (Oct-2026)

La pestaña Tasas tenía un único gráfico de barras con "Pesos" y "Dólares"
como dos series toggleables (`renderTasaChart()`, canvas `#tasaChart`). A
pedido de CONINAGRO se separó en dos gráficos independientes:

- **Tasa en pesos** (`renderTasaPesosChart()`, canvas `#tasaPesosChart`):
  agrega un selector **Nominal / Real** (`#tasaPesosModeSeg`). En
  "Real" se descuenta la inflación de la tasa nominal reportada.
- **Tasa en dólares** (`renderTasaDolaresChart()`, canvas
  `#tasaDolaresChart`): queda igual que antes, siempre nominal -- no
  tiene selector.

El selector Nominal/Real **solo existe en este gráfico de la pestaña
Tasas**. La tasa ponderada nacional de la pestaña Resumen
(`renderResumenTasaChart()`) sigue siendo siempre nominal, sin cambios --
así lo pidió explícitamente CONINAGRO.

### Metodología de la tasa real

**Fórmula (Fisher)**, elegida por CONINAGRO entre las opciones ofrecidas:

```
tasa_real = (1 + tasa_nominal/100) / (1 + inflación_12m/100) - 1   [× 100 para %]
```

**Inflación de referencia**: en vez de la inflación interanual de los 12
meses PREVIOS al dato (que queda rezagada respecto al trimestre), se usa
una **ventana centrada** de 12 meses: 6 meses antes + 6 meses después del
mes de cierre del trimestre, sin contar ese mes (offsets -6..-1, +1..+6).
Es la inflación compuesta (multiplicativa, no la suma simple) de esos 12
meses. Función `centered_inflacion_12m()` en `build_data.py`, campo
`inflacion_12m_centrada` en cada `resumen_nacional[i]` (uno por
trimestre, igual que el resto de esa estructura).

**Fuente de los datos de inflación** -- `data/ipc_mensual.csv`
(158 filas, Ene-2014 a Feb-2027, columnas `anio,mes,inflacion_mensual_pct,fuente`):

- **INDEC** (real, 152 meses: Ene-2014 a Ago-2026): IPC Nacional, variación
  mensual, "Nivel general" / "Total nacional". Ene-2014 a Dic-2016 se
  cargó a mano con los valores publicados por INDEC (esos años no
  estaban en la planilla que exporta la serie 2017-2026 en adelante);
  Ene-2017 a Ago-2026 sale de la planilla oficial `Variación mensual IPC
  Nacional.xls`.
- **REM** (proyección, 6 meses: Sep-2026 a Feb-2027): expectativas de
  mercado (Relevamiento de Expectativas de Mercado del BCRA) para
  completar la ventana centrada de los trimestres más recientes, que
  todavía no tienen los 6 meses posteriores publicados por INDEC. Dato
  dado por CONINAGRO: 1,7% mensual para los primeros 3 meses (Sep/Oct/Nov-26),
  1,5% para los siguientes 3 (Dic-26/Ene-27/Feb-27).

Con esa cobertura, los 46 trimestres del dashboard (Mar-15 a Jun-26)
tienen la ventana centrada completa. Solo los dos trimestres más
recientes dependen parcialmente de la proyección REM en vez de un dato
INDEC ya publicado: Mar-26 (1 de los 12 meses de su ventana) y Jun-26
(4 de los 12). Eso se expone en `inflacion_meses_proyectados` (0-12) en
cada `resumen_nacional[i]`, y el frontend muestra un aviso corto debajo
del gráfico cuando el trimestre visible en modo "Real" usa algún mes
proyectado.

**Verificación**: se armó `data/ipc_mensual.csv` combinando las 4 fuentes
(dos tablas de INDEC pegadas en el chat para 2014-2015 y 2016, la
planilla INDEC para 2017-2026, y la proyección REM) y se confirmó que
cubre los 158 meses esperados sin huecos ni duplicados. Después de
regenerar `dashboard_data.json`, un script independiente (que relee el
CSV y recalcula la ventana centrada con su propia lógica, sin reutilizar
ninguna función de `build_data.py`) comparó `inflacion_12m_centrada` e
`inflacion_meses_proyectados` para los 46 trimestres: 0 discrepancias.
También se verificó en el navegador (Playwright) que la tasa real que
efectivamente grafica Chart.js, para una actividad de prueba y varios
trimestres, coincide con el cálculo manual de Fisher sobre el JSON.

## Saldo en pesos constantes (Saldos, Oct-2026)

El selector de moneda de la pestaña Saldos (`#curSeg`) tenía 3 opciones:
Total (equivalente en US$), Pesos y Dólares. Se agregó una cuarta:
**Pesos constantes**, que muestra el saldo total ajustado por inflación a
precios del **último trimestre de la serie** (hoy Jun-26 -- se recalcula
solo con cada actualización trimestral, nunca queda una fecha
hardcodeada). Aplica al gráfico de evolución, las tiles y el mapa/ranking
por provincia de Saldos -- no a la pestaña Resumen, que sigue siempre en
pesos corrientes.

### Metodología

**Fuente**: `data/ipc_indice_mensual.csv` (140 filas, Ene-2015 a Ago-2026,
columnas `anio,mes,ipc_indice`), extraído del Excel de índice de precios +
factor de ajuste que pasó CONINAGRO. A diferencia de `data/ipc_mensual.csv`
(variación % mensual, usado para la tasa real de la pestaña Tasas), este
archivo trae el **índice de precios en nivel**, no la variación -- son dos
fuentes independientes para dos features distintas.

**Trimestral, no mensual**: como el saldo es un dato trimestral pero el
índice viene mes a mes, cada trimestre se ajusta con el **promedio** del
índice de sus 3 meses calendario (ej. el trimestre Mar-15 promedia
enero+febrero+marzo de 2015), en vez del dato puntual del mes de cierre --
así un mes particularmente volátil no distorsiona el ajuste de todo el
trimestre. Función `_quarter_avg_ipc()` en `build_data.py`.

**Factor**: para cada trimestre, `factor = promedio_del_último_trimestre /
promedio_de_ese_trimestre` (función `build_pesos_constantes_factor()`). El
último trimestre de la serie queda siempre con factor exactamente 1 -- su
saldo en pesos constantes es idéntico al saldo en pesos corrientes, tal
como pidió CONINAGRO ("el último valor no se va a haber modificado"). El
campo nuevo es `total_ars_constante`, calculado para cada
`actividades[].series[i]` y para cada provincia dentro de
`actividades[].provincias_series[i]`.

**Verificación**: se comparó el índice de este archivo contra
`data/ipc_mensual.csv` (la otra fuente de inflación del dashboard, usada
para la tasa real) para el período que ambos cubren (2015-2026): coinciden
casi exactamente desde 2017 en adelante (diferencia menor a 0,05 puntos
porcentuales mensuales, solo redondeo), pero difieren más en 2015-2016
(hasta ~1,9 puntos porcentuales en un mes puntual) -- esperable, ya que esa
fue la ventana en que INDEC estuvo intervenido y distintas fuentes
reconstruyen esos meses de forma distinta. Se usó igualmente el archivo
que pasó CONINAGRO para esta feature, tal como se indicó. Después de
regenerar `dashboard_data.json`, un script independiente (que relee el CSV
y recalcula el promedio trimestral y el factor con su propia lógica, sin
reutilizar ninguna función de `build_data.py`) comparó `total_ars_constante`
contra el valor esperado para las 21 actividades × 46 trimestres × todas
las provincias (24.150 valores en total): 0 discrepancias, y se confirmó
que el último trimestre (Jun-26) queda exactamente igual en las 21
actividades.

## Mapa de saldo (y de tasa) por provincia

El panel "Saldo por provincia" (pestaña Saldos) y el panel "Tasa por
provincia" (pestaña Tasas) combinan un mapa de Argentina coroplético con
el ranking de las 24 jurisdicciones, lado a lado. Cuanto más oscura una
provincia, mayor su saldo/tasa en la actividad, moneda (segmented
"Total/Pesos/Dólares" en Saldos, "Pesos/Dólares" en Tasas) y **trimestre**
elegidos -- ambos paneles siguen el extremo derecho del slider de
"Ventana de tiempo", no un dato fijo (ver sección anterior). Pasar el
mouse por una provincia del mapa -- o por una fila del listado -- muestra
un tooltip con el monto/tasa y resalta la contraparte (fila ↔ provincia)
para ubicarla fácil.

- **Los datos son series por período, no una foto fija**: cada actividad
  trae `provincias_series` y `tasas_provincias_series` en
  `dashboard_data.json`, un array con un desglose por provincia **por
  cada trimestre** (mismo índice que `periodos`/`series`/`tasas`), en vez
  de un único snapshot del último dato. `app.js` indexa ambos arrays con
  `state.rangeEnd` para saber qué trimestre mostrar. Esto multiplicó el
  peso del JSON (de ~150 KB a ~1,6 MB sin comprimir, ~240 KB con gzip,
  que es lo que efectivamente viaja por red) porque ahora hay 46 fotos en
  vez de 1 -- sigue siendo una sola descarga al cargar la página, nada
  que abra de golpe una app que ya carga Chart.js por CDN.
- **`data/ar_map.json`**: geometría del mapa ya proyectada y lista para
  SVG -- `{ viewBox, paths: { "<nombre de provincia>": "<d de un
  <path>>" }, caba: {x, y} }`. Las 23 provincias vienen de
  [alvarezgarcia/provincias-argentinas-geojson](https://github.com/alvarezgarcia/provincias-argentinas-geojson)
  (GeoJSON público, uno por provincia); CABA no viene en ese repo por ser
  minúscula a esta escala, así que se dibuja como un círculo en su
  centroide (fuente: API de Georef del Ministerio del Interior). Las
  claves de `paths` son exactamente los nombres que ya usa cada entrada de
  `provincias_series`/`tasas_provincias_series` en `dashboard_data.json`
  (`"BS AS"`, `"CABA"`, `"Santiago del estero"`, `"Tierra del fuego"`,
  etc.), así no hace falta ningún diccionario de traducción en el
  frontend.
- Cómo se generó: se bajó el GeoJSON de cada provincia, se proyectaron
  lon/lat con una proyección equirrectangular simple (x = lon·cos(lat₀),
  y = -lat, con lat₀ el promedio de latitud del país) y se simplificó
  cada polígono con Ramer-Douglas-Peucker para que el archivo pese poco
  (~68 KB para las 23 provincias). El script no quedó en el repo porque
  es un paso único (el mapa de Argentina no cambia); si hay que
  regenerarlo o ajustar la simplificación, hay que volver a bajar los 23
  GeoJSON de ese repo.
- **Escala de color** (`provColorScale()` en `app.js`): en vez de una
  escala lineal, usa la raíz cuadrada del saldo relativo al máximo *de la
  vista actual* (misma actividad y moneda). Con escala lineal, como BS
  AS/Córdoba/Santa Fe/CABA concentran la mayoría del crédito en casi
  todas las actividades, el resto de las provincias se verían todas casi
  blancas y no se distinguirían entre sí; con raíz cuadrada se nota mejor
  el escalón entre provincias medianas y chicas. El máximo se recalcula
  para cada actividad/moneda, así que el mapa siempre usa todo el rango
  de contraste disponible (p. ej. en Tabaco, Jujuy y Salta salen bien
  oscuras aunque su saldo sea mucho menor al de BS AS en Total).
- Las provincias sin dato para la moneda elegida se pintan de un gris
  clarito fijo (`.prov-nodata`), no de blanco, para diferenciar "sin
  desglose" de "saldo muy bajo".
- **El panel de Tasas reutiliza el de Saldos**: mismo esquema de mapa +
  ranking completo de las 24 jurisdicciones, coloreado por tasa en vez de
  saldo. Reemplazó a las dos tablas viejas ("Tasas más altas/bajas por
  provincia", top 5 cada una). En `app.js`,
  `makeProvincePanel(mapElId, tooltipElId, bodyElId)` factoriza el manejo
  de tooltip/hover (antes atado a los ids fijos `provMap`/`provTooltip`/
  `provBody`) para que Saldos y Tasas puedan tener cada uno su propia
  instancia (`provPanelSaldos`, `provPanelTasas`) sin duplicar código; el
  armado del SVG y el color siguen en cada `render*` porque difieren
  bastante (moneda + `sqrt` vs. tasa + escala lineal, ver abajo).
- **Selector de moneda propio en Tasas** (`#tasaProvCurSeg`, arriba a la
  derecha del panel, junto al título -- clase `.panelhead` en
  `styles.css`): Pesos/Dólares, independiente del segmented de Saldos y
  también independiente de la leyenda clickeable del gráfico "Tasa
  nacional por trimestre" (esa solo oculta/muestra series del gráfico, no
  cambia qué moneda mira el mapa). Guarda su elección en
  `state.curTasaProv` y solo vuelve a dibujar el panel de provincia
  (`renderTasaProvinceMap`), no toda la vista.
  - **Escala de color distinta**: a diferencia del saldo (unas pocas
    provincias concentran casi todo el crédito → raíz cuadrada desde 0),
    la tasa de interés no tiene esa concentración -- ninguna provincia
    tiene "casi toda la tasa". Por eso el mapa de tasas normaliza
    linealmente entre el mínimo y el máximo *de las provincias con dato
    en esa actividad, moneda y trimestre*, no entre 0 y el máximo: así
    aprovecha todo el degradé en vez de que todo el mapa salga oscuro (si
    usara 0 como piso, con tasas típicamente entre 30% y 90%, casi todas
    las provincias caerían muy cerca del extremo oscuro).
  - **Aviso sobre los 0,0%**: en `tasas_provincias_series[i].pesos`, una
    provincia sin operaciones reportadas para esa actividad/trimestre
    viene como `0.0`, no como `null` (mismo criterio que ya usaba
    `.dolares`). El mapa y el listado los muestran como una tasa real de
    0,0% -- es el mismo comportamiento que ya tenían las tablas viejas de
    "más bajas por provincia" (podían mostrar estos mismos ceros), solo
    que ahora se ven los 24 en vez de 6 y quedan más a la vista. Si en
    algún momento se quiere distinguir "0% real" de "sin operaciones",
    habría que sumar un campo aparte en `build_data.py` (hoy la fuente
    BCRA no lo distingue).

## Formato de montos chicos

Antes, cualquier saldo se mostraba siempre en millones de dólares/pesos con
un decimal, así que un saldo por debajo de los USD 50 mil (común en el
desglose por provincia de una actividad chica) se veía como "US$ 0,0 M" --
un valor que existe pero no se puede leer. `fmtMillones()` en `app.js`
ahora elige la escala según la magnitud: mil millones ("MM"), millones
("M"), miles ("K") o el número plano, de mayor a menor según corresponda.
El eje Y del gráfico de evolución de saldo hace lo mismo, pero a nivel de
todo el gráfico (no puede haber dos escalas distintas en un mismo eje):
elige la escala según el valor más alto que haya que graficar en la
ventana de tiempo seleccionada. El tramo "MM" se agregó junto con la
corrección de unidad de SALDOS (ver más arriba): con los montos ×1000, el
total nacional y las actividades más grandes ya entran en los miles de
millones de pesos, no solo en millones.

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
