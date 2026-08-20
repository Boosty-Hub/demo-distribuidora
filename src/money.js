// Distribuidora Demo — aritmética de dinero
//
// `45.402,00 Bs / 756,7` NO da 60 en coma flotante: da 59,99999999999999. Con eso, un cobro que
// salda la factura exacta se guardaba como `pagado = 59,99999999999999` y la comparación
// `pagado >= monto` daba FALSO → la cuenta quedaba en **'parcial'** con saldo 0,00, mientras el
// historial de pagos mostraba $60,00 (ahí sí se redondea, al armar la fila del pago). Reportado el
// 2026-08-07 sobre una factura BCV de $60.
//
// No es un caso de borde: el monto en bolívares se sugiere como `saldo × tasa` redondeado a 2
// decimales, así que la vuelta a dólares casi nunca cae exacta. Afecta a TODO cobro o pago en
// bolívares que salda la cuenta completa.
//
// Hacen falta las DOS defensas:
//   1. `ssRound2` donde NACE el monto — la plata tiene centavos, no 14 decimales.
//   2. `ssSaldada` en toda comparación de saldo: un cobro repartido entre varios métodos se
//      redondea línea por línea y puede no sumar el total exacto. Menos de un centavo no es una
//      deuda; dejarlo abierto manda a alguien a perseguir un saldo de 0,00.
//
// ── Por qué un archivo propio ───────────────────────────────────────────────────────────────
// Lo usan tres entornos que cargan cosas distintas: el navegador (index.html), el banco de
// pruebas visual (tests/visual/harness.html, que carga los chunks pero NO supabase.js) y la
// prueba de reversión de cobros (tests/revertir-cobro.mjs, que carga supabase.js SOLO, en un
// sandbox de node). Ponerlo en core.jsx o en supabase.js dejaba a uno de los tres sin la función;
// copiarlo en los dos lados es exactamente el patrón que ya nos costó caro con la cobertura BCV.
// Va primero en el orden de carga y no depende de nada.
(function () {
  // Redondeo a centavos. El `Number.EPSILON` corrige los casos que caen justo debajo del medio
  // centavo por representación binaria (1.005 → 1.00 sin él).
  window.ssRound2 = function (n) {
    const v = parseFloat(n);
    if (!isFinite(v)) return 0;
    return Math.round((v + Number.EPSILON) * 100) / 100;
  };

  // ¿La cuenta está saldada? Medio centavo de tolerancia. Se conserva el caso `monto = 0` como
  // saldado (0 >= -0,005), que es lo que hacía la comparación cruda `pagado >= monto`.
  window.ssSaldada = function (pagado, monto) {
    return (parseFloat(pagado) || 0) >= (parseFloat(monto) || 0) - 0.005;
  };

  // ── Cómo se ROTULA una factura ──────────────────────────────────────────────────────────────
  //
  // Una nota **con IVA se muestra como factura** (pedido del 2026-08-07). En este sistema la
  // "Nota de Factura" es el documento INTERNO, sin número de control; si el documento desglosa un
  // tributo que se declara, rotularlo así se contradice con lo que él mismo dice. Manda el IVA
  // sobre el tipo elegido, en cualquier modalidad (divisas, paralelo, BCV): el impuesto no depende
  // de en qué se pague.
  //
  // ES SOLO EL RÓTULO. `tipo_factura` no se toca — no se cambia un dato guardado por cómo se ve.
  // Vive acá y no en core.jsx porque lo usan pos.jsx (lista y detalle) y pdf.jsx, y money.js se
  // carga antes que todos.
  window.ssTieneIva = function (doc) {
    if (!doc) return false;
    return doc.aplica_iva === true || (parseFloat(doc.iva) || 0) > 0;
  };
  window.ssRotuloFactura = function (doc) {
    return (doc && doc.tipo_factura === 'nota' && !window.ssTieneIva(doc))
      ? 'Nota de Factura'
      : 'Factura Fiscal';
  };
})();
