// Distribuidora Demo — catalogos curados (materia prima del generador)
//
// Nombres, productos, ciudades, bancos: todo ficticio, elegido para que la demo se vea como un
// negocio real venezolano sin ser NINGUNA empresa real. `generator.js` combina esto con el PRNG
// con semilla (prng.js) para construir el dataset relacional final de cada empresa.
(function () {
  const CIUDADES_VE = [
    'Caracas', 'Valencia', 'Maracaibo', 'Barquisimeto', 'Maracay',
    'San Cristobal', 'Puerto La Cruz', 'Maturin', 'Barcelona', 'Guarenas',
  ];

  const BANCOS_VE = [
    { banco: 'Banesco',         moneda: 'VES', color: '#01703c' },
    { banco: 'Mercantil',       moneda: 'VES', color: '#f57e20' },
    { banco: 'Banco de Venezuela', moneda: 'VES', color: '#e30613' },
    { banco: 'BOD',             moneda: 'VES', color: '#003b71' },
    { banco: 'Zelle',           moneda: 'USD', color: '#6d1ed4' },
    { banco: 'Binance',         moneda: 'USD', color: '#f0b90b' },
    { banco: 'Caja chica',      moneda: 'USD', color: '#6b6a65' },
  ];

  const NOMBRES = [
    'Carlos','Maria','Jose','Ana','Luis','Carmen','Miguel','Rosa','Pedro','Laura',
    'Juan','Andrea','Rafael','Gabriela','Antonio','Daniela','Francisco','Valentina','Manuel','Camila',
    'Jesus','Isabel','Ricardo','Patricia','Eduardo','Alejandra','Roberto','Veronica','Diego','Fernanda',
    'Oscar','Claudia','Victor','Adriana','Cesar','Beatriz','Angel','Yolanda','Ramon','Sofia',
  ];
  const APELLIDOS = [
    'Gonzalez','Rodriguez','Perez','Sanchez','Ramirez','Torres','Flores','Diaz','Morales','Ortiz',
    'Gomez','Martinez','Hernandez','Lopez','Castillo','Rivas','Marquez','Suarez','Rojas','Pena',
    'Guerrero','Medina','Herrera','Aguilar','Vargas','Salazar','Reyes','Mendoza','Silva','Romero',
  ];

  // Sufijos de razon social para clientes/proveedores B2B (no marcas reales)
  const SUFIJOS_EMPRESA = ['C.A.', 'S.A.', 'de Venezuela C.A.', 'Group C.A.', '2000 C.A.'];
  const RUBROS_CLIENTE_DEMO1 = [
    'Ferreteria', 'Constructora', 'Electricidad', 'Instalaciones', 'Ingenieria',
    'Mantenimiento Industrial', 'Servicios Electricos', 'Obras Civiles', 'Suministros Tecnicos', 'Automatizacion',
  ];
  const RUBROS_CLIENTE_DEMO2 = [
    'Gimnasio', 'Nutricion', 'Fitness Center', 'Wellness', 'Suplementos',
    'Vida Sana', 'Deportivo', 'CrossTraining', 'Salud Integral', 'Bienestar',
  ];

  window.__ssDemoCatalogos = {
    CIUDADES_VE,
    BANCOS_VE,
    NOMBRES,
    APELLIDOS,
    SUFIJOS_EMPRESA,
    RUBROS_CLIENTE_DEMO1,
    RUBROS_CLIENTE_DEMO2,

    // ── Distribuidora Demo 1 — distribucion tecnica / electrica / ferreteria industrial ──
    MARCAS_DEMO1: ['VoltMax','ElectroPro','TuboFer','CondufElec','LumiTech','SafeGrid','TornilloMax','PowerLine'],
    CATEGORIAS_DEMO1: [
      'Cableado', 'Iluminacion', 'Interruptores y Tomas', 'Tableros Electricos', 'Herramientas',
      'Tuberia y Conduit', 'Ferreteria General', 'Energia y UPS', 'Redes y Datos', 'Tornilleria',
    ],
    PRODUCTOS_DEMO1: [
      ['Cable THHN #12 AWG (rollo 100m)','Cableado',42.00,58.00,10.5],
      ['Cable THHN #10 AWG (rollo 100m)','Cableado',58.00,79.00,13.2],
      ['Cable encauchetado 3x14 (rollo 50m)','Cableado',35.00,49.00,9.8],
      ['Cable UTP Cat6 (caja 305m)','Redes y Datos',95.00,129.00,11.0],
      ['Bombillo LED 9W luz calida','Iluminacion',1.20,2.50,0.06],
      ['Bombillo LED 15W luz fria','Iluminacion',1.80,3.40,0.09],
      ['Panel LED 60x60 40W','Iluminacion',14.00,23.00,1.8],
      ['Reflector LED 50W exterior','Iluminacion',9.50,16.50,1.2],
      ['Lampara colgante industrial','Iluminacion',22.00,36.00,2.4],
      ['Interruptor sencillo 15A','Interruptores y Tomas',1.10,2.20,0.08],
      ['Interruptor doble 15A','Interruptores y Tomas',1.60,3.00,0.10],
      ['Tomacorriente doble polarizado','Interruptores y Tomas',1.30,2.60,0.09],
      ['Tomacorriente GFCI 20A','Interruptores y Tomas',6.50,11.00,0.15],
      ['Breaker termico 1P 20A','Tableros Electricos',3.20,5.80,0.20],
      ['Breaker termico 2P 40A','Tableros Electricos',7.80,13.50,0.45],
      ['Tablero electrico 12 puestos','Tableros Electricos',18.00,29.00,3.1],
      ['Tablero electrico 24 puestos','Tableros Electricos',32.00,52.00,5.4],
      ['Contactor trifasico 40A','Tableros Electricos',24.00,39.00,1.1],
      ['Taladro percutor 1/2 pulg','Herramientas',38.00,62.00,2.3],
      ['Amoladora angular 4.5 pulg','Herramientas',26.00,44.00,1.9],
      ['Multimetro digital','Herramientas',9.00,16.00,0.4],
      ['Pinza amperimetrica','Herramientas',14.00,24.00,0.5],
      ['Juego de destornilladores (6 pzas)','Herramientas',7.50,13.00,0.6],
      ['Escalera tijera 6 pies aluminio','Herramientas',48.00,79.00,7.5],
      ['Tubo conduit PVC 1/2" (unidad 3m)','Tuberia y Conduit',2.10,3.80,1.1],
      ['Tubo conduit PVC 3/4" (unidad 3m)','Tuberia y Conduit',2.80,4.90,1.4],
      ['Codo conduit PVC 1/2"','Tuberia y Conduit',0.35,0.75,0.05],
      ['Caja octogonal PVC','Tuberia y Conduit',0.55,1.10,0.06],
      ['Cerradura de perilla estandar','Ferreteria General',6.50,11.50,0.35],
      ['Bisagra 3 pulg (par)','Ferreteria General',1.20,2.40,0.10],
      ['Candado 40mm','Ferreteria General',3.00,5.50,0.15],
      ['Cinta metrica 5m','Ferreteria General',2.20,4.00,0.15],
      ['UPS 1000VA interactiva','Energia y UPS',45.00,72.00,4.8],
      ['UPS 1500VA con regulador','Energia y UPS',68.00,109.00,6.1],
      ['Regulador de voltaje 1000W','Energia y UPS',22.00,36.00,2.0],
      ['Bateria 12V 7Ah para UPS','Energia y UPS',14.00,23.00,2.5],
      ['Switch 8 puertos Gigabit','Redes y Datos',18.00,29.00,0.5],
      ['Switch 24 puertos Gigabit','Redes y Datos',62.00,99.00,2.1],
      ['Router WiFi doble banda','Redes y Datos',24.00,39.00,0.6],
      ['Patch panel 24 puertos Cat6','Redes y Datos',16.00,27.00,1.3],
      ['Tornillo autorroscante 1/2" (caja 100)','Tornilleria',2.40,4.20,0.5],
      ['Tuerca hexagonal 3/8" (caja 100)','Tornilleria',3.10,5.40,0.8],
      ['Arandela plana 3/8" (caja 100)','Tornilleria',1.60,2.90,0.3],
      ['Perno de anclaje 1/2x4"','Tornilleria',0.60,1.20,0.15],
    ],

    // ── Suplementos Demo 2 — nutricion deportiva / vida saludable ──
    MARCAS_DEMO2: ['ProteinLab','VitaCore','FitFuel','MaxGain','PureNutri','EnergyPeak','LeanBody','NutriPro'],
    CATEGORIAS_DEMO2: [
      'Proteinas', 'Pre-Entreno', 'Vitaminas', 'Aminoacidos', 'Quemadores',
      'Snacks Saludables', 'Accesorios Fitness', 'Bienestar General',
    ],
    PRODUCTOS_DEMO2: [
      ['Proteina Whey 2lb sabor chocolate','Proteinas',22.00,38.00,1.1],
      ['Proteina Whey 5lb sabor vainilla','Proteinas',48.00,79.00,2.6],
      ['Proteina Vegana 2lb sabor cacao','Proteinas',26.00,44.00,1.1],
      ['Caseina micelar 2lb','Proteinas',28.00,47.00,1.1],
      ['Pre-entreno explosivo 300g','Pre-Entreno',18.00,32.00,0.4],
      ['Pre-entreno sin cafeina 300g','Pre-Entreno',17.00,30.00,0.4],
      ['Bebida energizante pre-workout (lata)','Pre-Entreno',1.80,3.20,0.5],
      ['Multivitaminico 90 capsulas','Vitaminas',9.50,17.00,0.2],
      ['Vitamina C 1000mg 60 tabletas','Vitaminas',6.00,11.00,0.15],
      ['Vitamina D3 60 capsulas','Vitaminas',7.50,13.50,0.1],
      ['Complejo B 100 tabletas','Vitaminas',6.80,12.00,0.18],
      ['Omega 3 90 capsulas','Vitaminas',10.00,18.00,0.2],
      ['BCAA 2:1:1 300g','Aminoacidos',14.00,25.00,0.4],
      ['Glutamina 300g','Aminoacidos',13.00,23.00,0.35],
      ['Creatina monohidratada 300g','Aminoacidos',12.00,21.00,0.35],
      ['Arginina 90 capsulas','Aminoacidos',8.50,15.00,0.15],
      ['Quemador de grasa termogenico 60 caps','Quemadores',16.00,28.00,0.15],
      ['L-Carnitina liquida 500ml','Quemadores',11.00,19.50,0.6],
      ['CLA 1000mg 90 capsulas','Quemadores',13.50,24.00,0.2],
      ['Barra de proteina chocolate (unidad)','Snacks Saludables',1.50,2.80,0.06],
      ['Barra de proteina mani (unidad)','Snacks Saludables',1.50,2.80,0.06],
      ['Mix de frutos secos 200g','Snacks Saludables',3.20,5.80,0.2],
      ['Avena instantanea 1kg','Snacks Saludables',3.80,6.50,1.0],
      ['Galletas proteicas (caja 6 uds)','Snacks Saludables',6.00,10.50,0.4],
      ['Shaker 600ml con malla','Accesorios Fitness',3.50,6.50,0.15],
      ['Guantes de entrenamiento (par)','Accesorios Fitness',8.00,14.00,0.2],
      ['Cinturon lumbar de entrenamiento','Accesorios Fitness',12.00,21.00,0.5],
      ['Banda elastica de resistencia','Accesorios Fitness',4.50,8.00,0.1],
      ['Cuerda para saltar profesional','Accesorios Fitness',5.00,9.00,0.2],
      ['Straps de agarre (par)','Accesorios Fitness',4.00,7.50,0.1],
      ['Colageno hidrolizado 300g','Bienestar General',15.00,26.00,0.4],
      ['Melatonina 5mg 60 capsulas','Bienestar General',6.50,11.50,0.1],
      ['Magnesio 400mg 90 capsulas','Bienestar General',7.00,12.50,0.15],
      ['Probiotico 30 capsulas','Bienestar General',10.50,18.50,0.1],
      ['Te verde en capsulas 90 uds','Bienestar General',7.80,14.00,0.15],
      ['Electrolitos en polvo 300g','Bienestar General',9.00,16.00,0.35],
      ['Ashwagandha 60 capsulas','Bienestar General',8.00,14.50,0.12],
      ['Zinc 50mg 90 tabletas','Bienestar General',5.50,10.00,0.1],
      ['Colageno + Vitamina C 300g','Bienestar General',16.00,28.00,0.4],
      ['Fibra dietetica 400g','Bienestar General',7.20,13.00,0.5],
    ],
  };
})();
