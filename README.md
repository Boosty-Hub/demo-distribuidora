# Distribuidora Demo — ERP multi-empresa (demo comercial)

Réplica **100% estática y sin backend** de un ERP multi-empresa real, hecha para mostrarle a
clientes potenciales cómo se ve y se siente el producto. Todos los nombres, empresas, personas,
productos y montos son **ficticios** — no hay ninguna base de datos real detrás.

## Qué es

- Dos empresas demo, con catálogo, clientes, proveedores e inventario propios:
  - **Distribuidora Demo 1** — distribución técnica/eléctrica y ferretería industrial.
  - **Suplementos Demo 2** — nutrición deportiva y vida saludable.
- Login de un clic por rol (Administrador, Gerente de Operaciones, Ventas, Contadora, Almacén
  Central, Driver, Cliente) para ver cómo cambian el sidebar y los permisos según quién entra.
- POS con ciclo documental completo (cotización → orden → factura → despacho), inventario
  multi-almacén, CxC/CxP, bancos, roles y permisos, portal del cliente, y más.
- **Los datos se generan en el navegador** cada vez que se carga la página (con semilla fija, así
  que el dataset es el mismo en cada visita) y **cualquier cambio que hagas se pierde al recargar**
  — es un modo demo, no un sistema en producción.

## Desarrollo local

```bash
npm install
node build.js          # compila src/components/*.jsx y src/demo/*.js a src/dist/
cd src && npx serve --single -p 8080 .
```

Abrir `http://localhost:8080`.

## Despliegue

Se publica solo en GitHub Pages vía `.github/workflows/deploy.yml` (build + deploy automático en
cada push a `main`). No hay ningún otro entorno.

## Cómo está armado

- `src/components/*.jsx` — la aplicación (heredada de un ERP real; la lógica de negocio se
  conservó intacta a propósito, es lo que hace creíble la demo).
- `src/supabase.js` — la capa de datos original, también intacta salvo por su cliente.
- `src/demo/` — el motor mock que reemplaza el backend real: genera el dataset de las 2 empresas
  (`generator.js`, con catálogos en `catalogos.js` y un PRNG con semilla en `prng.js`), lo guarda en
  memoria (`db.js`) y expone un cliente falso con la misma forma que `supabase-js`
  (`mock-sb.js`) — así el resto de la app no nota la diferencia.
