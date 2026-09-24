(function(){
  async function boot(){
    const DATA = await fetch('data/dashboard_data.json').then(r=>r.json());

  
  const PERIODOS = DATA.periodos;
  const PLABEL = DATA.periodos_label;

  const fmtInt = new Intl.NumberFormat('es-AR', {maximumFractionDigits:0});
  const fmt1 = new Intl.NumberFormat('es-AR', {maximumFractionDigits:1, minimumFractionDigits:1});
  const fmtPct = new Intl.NumberFormat('es-AR', {maximumFractionDigits:1, minimumFractionDigits:1});

  function fmtMillones(v, prefix){
    if(v===null||v===undefined) return '—';
    const m = v/1e6;
    return prefix + ' ' + fmt1.format(m) + ' M';
  }
  function currencyMeta(cur){
    if(cur==='pesos') return {prefix:'$', field:'pesos_ars', provField:'pesos_ars', label:'en pesos'};
    if(cur==='dolares') return {prefix:'US$', field:'dolares_usd', provField:'dolares_usd', label:'en dólares'};
    return {prefix:'US$', field:'total_usd', provField:'total_usd', label:'total, equivalente en US$'};
  }

  const state = { tab:'saldos', actId: DATA.actividades[0].id, cur:'total' };

  function getAct(id){ return DATA.actividades.find(a=>a.id===id); }

  // ---------- Activity sidebar ----------
  function renderPills(container, onClick){
    container.innerHTML='';
    DATA.actividades.forEach(a=>{
      const b = document.createElement('button');
      b.className = 'sbrow' + (a.id===state.actId ? ' active':'');
      const limitada = !a.saldos_moneda_completo || !a.tasas_completo;
      b.innerHTML = '<span>'+a.nombre+'</span>' + (limitada ? '<span class="dot" title="Datos parciales: ver aviso en la vista"></span>' : '');
      b.addEventListener('click', ()=>{ state.actId=a.id; onClick(); });
      container.appendChild(b);
    });
  }

  // ---------- Tabs ----------
  document.getElementById('tabsNav').addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-tab]');
    if(!btn) return;
    state.tab = btn.dataset.tab;
    [...document.getElementById('tabsNav').children].forEach(c=>c.classList.toggle('active', c===btn));
    document.getElementById('view-saldos').style.display = state.tab==='saldos' ? '' : 'none';
    document.getElementById('view-tasas').style.display = state.tab==='tasas' ? '' : 'none';
    renderAll();
  });

  document.getElementById('curSeg').addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-cur]');
    if(!btn || btn.disabled) return;
    state.cur = btn.dataset.cur;
    [...document.getElementById('curSeg').children].forEach(c=>c.classList.toggle('active', c===btn));
    renderSaldosView();
  });

  let evolChart, tasaChart;

  function renderTiles(act){
    const meta = currencyMeta(state.cur);
    const series = act.series;
    const valid = series.filter(s=>s && s[meta.field]!==null && s[meta.field]!==undefined);
    const last = valid[valid.length-1];
    const first = valid[0];
    const wrap = document.getElementById('tiles');
    wrap.innerHTML='';

    const tileActual = document.createElement('div');
    tileActual.className='tile';
    tileActual.innerHTML = '<div class="label">Saldo · '+(last?PLABEL[last.periodo]:'—')+'</div>'
      + '<div class="value mono">'+(last?fmtMillones(last[meta.field], meta.prefix):'—')+'</div>'
      + '<div class="unit">'+meta.label+'</div>';
    wrap.appendChild(tileActual);

    const tileVar = document.createElement('div');
    tileVar.className='tile';
    let varHtml = '<div class="label">Variación del período</div>';
    if(first && last && first!==last && first[meta.field]){
      const pct = ((last[meta.field]-first[meta.field])/Math.abs(first[meta.field]))*100;
      const good = pct>=0;
      varHtml += '<div class="value mono">'+(good?'+':'')+fmtPct.format(pct)+'%</div>'
        + '<span class="chip '+(good?'good':'bad')+'">'+(good?'▲ suba':'▼ baja')+' vs '+PLABEL[first.periodo]+'</span>';
    } else {
      varHtml += '<div class="value mono">—</div><div class="unit">sin serie suficiente</div>';
    }
    tileVar.innerHTML = varHtml;
    wrap.appendChild(tileVar);

    const tileMezcla = document.createElement('div');
    tileMezcla.className='tile';
    if(last && last.pesos_ars!==null && last.dolares_usd!==null && last.total_ars){
      const shareUsd = (last.dolares_usd*last.tc)/last.total_ars*100;
      tileMezcla.innerHTML = '<div class="label">Mix por moneda</div>'
        + '<div class="value mono">'+fmtPct.format(shareUsd)+'%</div>'
        + '<div class="unit">del saldo está en dólares</div>';
    } else {
      tileMezcla.innerHTML = '<div class="label">Mix por moneda</div><div class="value mono">—</div><div class="unit">sin desglose</div>';
    }
    wrap.appendChild(tileMezcla);

    const tileCobertura = document.createElement('div');
    tileCobertura.className='tile';
    const nTrim = series.filter(s=>s).length;
    tileCobertura.innerHTML = '<div class="label">Cobertura de datos</div>'
      + '<div class="value mono">'+nTrim+' / 4</div>'
      + '<div class="unit">'+(act.saldos_total_completo ? 'trimestres con dato' : 'trimestres con saldo total')+'</div>';
    wrap.appendChild(tileCobertura);
  }

  function renderChart(act){
    const meta = currencyMeta(state.cur);
    const labels = PERIODOS.map(p=>PLABEL[p]);
    const values = act.series.map(s => s && s[meta.field]!==undefined ? s[meta.field] : null);
    const lastIdx = values.reduce((acc,v,i)=> v!==null ? i : acc, -1);

    const styles = getComputedStyle(document.documentElement);
    const muted = styles.getPropertyValue('--bar-muted').trim();
    const hi = styles.getPropertyValue('--bar-highlight').trim();
    const textColor = styles.getPropertyValue('--text-muted').trim();
    const gridColor = styles.getPropertyValue('--border').trim();

    const bg = values.map((v,i)=> i===lastIdx ? hi : muted);

    const ctx = document.getElementById('evolChart').getContext('2d');
    if(evolChart) evolChart.destroy();
    evolChart = new Chart(ctx, {
      type:'bar',
      data:{ labels, datasets:[{
        data: values.map(v=>v===null?0:v/1e6),
        backgroundColor: bg,
        borderRadius: 5,
        maxBarThickness: 56,
      }]},
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false},
          tooltip:{ callbacks:{ label:(c)=> meta.prefix+' '+fmt1.format(c.raw)+' M' } }
        },
        scales:{
          x:{ grid:{display:false}, ticks:{ color:textColor, font:{size:11.5, weight:600} } },
          y:{ grid:{ color:gridColor }, ticks:{ color:textColor, font:{size:11}, callback:(v)=> meta.prefix+' '+fmt1.format(v)+'M' }, beginAtZero:true }
        }
      }
    });

    document.getElementById('chartDesc').innerHTML = 'Saldo <b>'+meta.label+'</b> de <b>'+act.nombre+'</b> por trimestre de 2025. La última barra marca el corte más reciente disponible.';
    document.getElementById('chartLegend').innerHTML =
      '<span><i style="background:'+muted+'"></i>trimestre anterior</span>'
      + '<span><i style="background:'+hi+'"></i>último dato</span>';
  }

  function renderProvinceTable(act){
    const meta = currencyMeta(state.cur);
    const provs = (act.provincias && act.provincias[meta.provField]) || {};
    const entries = Object.entries(provs).filter(([,v])=> v!==null && v!==undefined);
    entries.sort((a,b)=> b[1]-a[1]);
    const total = entries.reduce((s,[,v])=>s+v,0);
    const top = entries.slice(0,10);
    const max = top.length ? top[0][1] : 1;

    const body = document.getElementById('provBody');
    body.innerHTML='';
    if(!top.length){
      body.innerHTML = '<tr><td colspan="4" style="color:var(--text-faint); padding:16px 10px;">No hay desglose por provincia para esta vista de moneda.</td></tr>';
    } else {
      top.forEach(([name,val], i)=>{
        const tr = document.createElement('tr');
        const pct = total ? (val/total*100) : 0;
        const w = max ? (val/max*100) : 0;
        tr.innerHTML = '<td><span class="rank">'+(i+1)+'</span></td>'
          + '<td class="prov">'+name+'</td>'
          + '<td class="num mono">'+fmtMillones(val, meta.prefix)+'<div class="barcell"><i style="width:'+w.toFixed(1)+'%"></i></div></td>'
          + '<td class="num sharecol mono">'+fmtPct.format(pct)+'%</td>';
        body.appendChild(tr);
      });
    }
    document.getElementById('provDesc').innerHTML = 'Ranking de provincias por saldo <b>'+meta.label+'</b> al último dato disponible ('+PLABEL[act.ultimo_periodo]+').';
  }

  function renderSaldosView(){
    const act = getAct(state.actId);
    const noteEl = document.getElementById('partialNoteSaldos');
    const noteText = document.getElementById('partialNoteSaldosText');
    if(!act.saldos_total_completo){
      const lastLbl = act.ultimo_periodo ? PLABEL[act.ultimo_periodo] : '—';
      noteText.innerHTML = 'Esta actividad solo tiene saldo total reportado hasta <b>'+lastLbl+'</b>. No hay serie trimestral completa.';
      noteEl.style.display = 'flex';
    } else if(!act.saldos_moneda_completo){
      noteText.innerHTML = 'El saldo <b>total</b> está completo para los 4 trimestres, pero esta actividad no tiene desglose por moneda (pesos/dólares) reportado.';
      noteEl.style.display = 'flex';
    } else {
      noteEl.style.display = 'none';
    }

    const segBtns = document.getElementById('curSeg').querySelectorAll('button');
    segBtns.forEach(b=>{
      const c = b.dataset.cur;
      b.disabled = !act.saldos_moneda_completo && c!=='total';
    });
    if(!act.saldos_moneda_completo && state.cur!=='total'){
      state.cur = 'total';
      segBtns.forEach(b=>b.classList.toggle('active', b.dataset.cur==='total'));
    }

    const validTc = act.series.filter(s=>s);
    document.getElementById('tcNote').textContent = 'TC usado: ' + validTc.map(s=>PLABEL[s.periodo]+' $'+fmtInt.format(s.tc)).join(' · ');

    renderTiles(act);
    renderChart(act);
    renderProvinceTable(act);
  }

  function renderTasaChart(act){
    const labels = PERIODOS.map(p=>PLABEL[p]);
    const pesos = act.tasas.map(t=>t.pesos);
    const dolares = act.tasas.map(t=>t.dolares);

    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--accent').trim();
    const gold = styles.getPropertyValue('--gold').trim();
    const textColor = styles.getPropertyValue('--text-muted').trim();
    const gridColor = styles.getPropertyValue('--border').trim();

    const ctx = document.getElementById('tasaChart').getContext('2d');
    if(tasaChart) tasaChart.destroy();
    tasaChart = new Chart(ctx, {
      type:'bar',
      data:{ labels, datasets:[
        { label:'Pesos', data: pesos, backgroundColor: accent, borderRadius:5, maxBarThickness:34 },
        { label:'Dólares', data: dolares, backgroundColor: gold, borderRadius:5, maxBarThickness:34 },
      ]},
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:(c)=> c.dataset.label+': '+fmtPct.format(c.raw)+'%' } } },
        scales:{
          x:{ grid:{display:false}, ticks:{ color:textColor, font:{size:11.5, weight:600} } },
          y:{ grid:{ color:gridColor }, ticks:{ color:textColor, font:{size:11}, callback:(v)=> v+'%' }, beginAtZero:true }
        }
      }
    });
    document.getElementById('tasaLegend').innerHTML =
      '<span><i style="background:'+accent+'"></i>Pesos</span>'
      + '<span><i style="background:'+gold+'"></i>Dólares</span>';
  }

  function renderTasaTables(act){
    const provs = act.tasas_provincias.pesos || {};
    const entries = Object.entries(provs).filter(([,v])=> v!==null && v!==undefined);
    entries.sort((a,b)=> b[1]-a[1]);
    const top = entries.slice(0,6);
    const bottom = entries.slice(-6).reverse();

    function fillTable(el, list){
      el.innerHTML='';
      list.forEach(([name,val],i)=>{
        const tr = document.createElement('tr');
        tr.innerHTML = '<td><span class="rank">'+(i+1)+'</span></td><td class="prov">'+name+'</td><td class="num mono">'+fmtPct.format(val)+'%</td>';
        el.appendChild(tr);
      });
      if(!list.length) el.innerHTML = '<tr><td colspan="3" style="color:var(--text-faint); padding:16px 10px;">Sin datos.</td></tr>';
    }
    fillTable(document.getElementById('tasaTopBody'), top);
    fillTable(document.getElementById('tasaBottomBody'), bottom);
  }

  function renderTasasView(){
    const act = getAct(state.actId);
    const noteEl = document.getElementById('partialNoteTasas');
    const noteText = document.getElementById('partialNoteTasasText');
    if(!act.tasas_completo){
      const withData = act.tasas.filter(t=> t.pesos!==null || t.dolares!==null);
      const lastT = withData[withData.length-1];
      const soloPesos = withData.every(t=> t.dolares===null);
      noteText.innerHTML = lastT
        ? 'Esta actividad solo tiene tasa reportada hasta <b>'+PLABEL[lastT.periodo]+'</b>'+(soloPesos ? ', únicamente en pesos.' : '.')
        : 'Esta actividad no tiene tasa reportada.';
      noteEl.style.display = 'flex';
    } else {
      noteEl.style.display = 'none';
    }
    renderTasaChart(act);
    renderTasaTables(act);
  }

  function syncPills(){
    renderPills(document.getElementById('actSidebar'), pillClicked);
  }
  function pillClicked(){
    syncPills();
    if(state.tab==='saldos') renderSaldosView(); else renderTasasView();
  }
  function renderAll(){
    syncPills();
    if(state.tab==='saldos') renderSaldosView(); else renderTasasView();
  }

  renderAll();

  }
  boot();
})();
