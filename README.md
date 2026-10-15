# Nexo — Portales de Administración y Cliente

Aplicación web con React, Vite y TypeScript. Supabase proporciona autenticación por correo/contraseña, PostgreSQL y una API REST mediante PostgREST. Los portales comparten el mecanismo de autenticación; la autorización depende del rol real de la cuenta, verificado en PostgreSQL y en la Edge Function.

## Requisitos

- Node.js 20.19+ o 22.12+.
- Un proyecto creado en [Supabase](https://supabase.com/dashboard).
- Supabase CLI para aplicar migraciones y desplegar la Edge Function.

## Configurar la aplicación

1. En Supabase, confirma que **Authentication → Sign In / Providers → Email** esté habilitado.
2. En **Authentication → URL Configuration**, agrega `http://localhost:5173` a las URL permitidas.
3. En la raíz del proyecto, copia `.env.example` como `.env.local` y agrega los valores de **Project Settings → API**:

   ```env
   VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
   VITE_SUPABASE_ANON_KEY=tu-clave-publica-de-supabase
   ```

   `.env.local` está excluido de Git. La clave pública/anon puede estar en el frontend; nunca pongas una clave `service_role` en una variable `VITE_` ni en archivos públicos.

## Base de datos y roles

La migración `supabase/migrations/20261005000000_profiles_and_roles.sql` crea los perfiles y las políticas RLS.

1. Vincula el CLI con el proyecto Supabase:

   ```sh
   supabase login
   supabase link --project-ref TU_PROJECT_REF
   ```

2. Aplica la migración:

   ```sh
   supabase db push
   ```

El registro público crea perfiles con el rol `client` mediante un trigger de PostgreSQL. La selección de portal en la página **no** cambia el rol. El cliente solo puede actualizar `display_name` en su propio perfil; RLS impide cambiar rol o estado. Los administradores activos pueden consultar los perfiles, y el control de estado para datos del cliente se expone a través de la función de rol `is_active_user()`.

### Crear el primer administrador

1. Registra una cuenta desde el portal **Cliente** y confirma el correo si Supabase lo requiere.
2. En **Supabase → SQL Editor**, identifica el UUID de esa cuenta en **Authentication → Users**.
3. Ejecuta este SQL sustituyendo el UUID por el de la cuenta autorizada:

   ```sql
   update public.profiles
   set role = 'admin'
   where id = 'UUID-DE-LA-CUENTA'
     and role = 'client';
   ```

4. Comprueba que se actualizó una fila y que el rol quedó como `admin`.

No existe registro público de administradores ni un botón para otorgar roles en la aplicación. Solo un operador con permisos de Supabase debe ejecutar este paso.

## Inventario y compras

La migración `supabase/migrations/20261015000000_inventory_and_orders.sql` agrega:

- `products`: catálogo, precios, existencia y mínimo de stock. Los productos se desactivan en vez de borrarse para preservar el historial.
- `inventory_movements`: bitácora de entradas, salidas administrativas y ventas.
- `orders` y `order_items`: compras y precios/nombres guardados como estaban al momento de la venta.

El panel de administración permite crear y actualizar productos, activar u ocultar productos y registrar entradas/salidas con motivo. El cliente solo consulta productos activos con existencia, compra unidades y ve sus propias compras. Los pedidos y movimientos no se pueden insertar o modificar directamente desde el navegador: las funciones `create_product`, `adjust_inventory` y `place_order` validan permisos y actualizan stock dentro de una transacción. Las compras con stock insuficiente se rechazan sin crear un pedido parcial.

Aplica la nueva migración junto con las migraciones pendientes:

```sh
supabase db push
```

Si quieres revisar el SQL antes de aplicarlo, abre `supabase/migrations/20261015000000_inventory_and_orders.sql` en el editor de Supabase. No se necesita una clave `service_role` en el frontend.

## Edge Function de administración

`supabase/functions/manage-users/index.ts` lista perfiles de clientes y activa/desactiva sus cuentas. Antes de cada acción la función valida el token del usuario, consulta su rol y requiere un perfil `admin` activo. Usa la API administrativa de Supabase únicamente en el backend.

1. La función necesita `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` como variables de entorno de Edge Functions. Supabase normalmente provee estas variables al runtime; si tu entorno no las tiene, configúralas como secretos del proyecto, no en `.env.local` ni en el repositorio.
2. Despliega la función:

   ```sh
   supabase functions deploy manage-users
   ```

3. La configuración de `supabase/config.toml` desactiva la verificación JWT automática de la puerta de enlace porque la función valida la sesión explícitamente con `auth.getUser()` y vuelve a comprobar rol y estado en la base de datos. No elimines esos controles.

Al desactivar una cuenta, el perfil queda inactivo (bloqueando operaciones con RLS que usen `is_active_user()`) y Supabase Auth bloquea el inicio de sesión. Si una de las dos actualizaciones falla, la función devuelve un error explícito para que el administrador reintente o revise el estado en Supabase.

## Desarrollo

```sh
npm install
npm run dev
```

La pantalla inicial ofrece dos accesos:

- **Administrador:** solo permite iniciar sesión; la cuenta debe tener el rol `admin`.
- **Cliente:** permite iniciar sesión o registrarse. El registro público siempre crea un cliente.

Después de verificar el rol, el administrador tiene secciones de resumen, productos, entradas y salidas, movimientos y clientes. Puede crear productos, actualizar su información, registrar ajustes de stock y eliminar productos del catálogo. La eliminación es lógica (desactivación) para conservar el historial de ventas y movimientos; los productos se pueden restaurar.

El cliente tiene secciones de productos, carrito, compras e información de perfil. Puede agregar varios productos y cantidades al carrito, ajustar o quitar artículos y confirmar el pedido. La compra descuenta el stock de forma transaccional y no procesa cobros en línea. El carrito permanece en la sesión actual del navegador; los pedidos confirmados se guardan en Supabase.

## Compilar

```sh
npm run build
npm run lint
npm run preview
```

## Desplegar la web en Vercel

1. Sube el proyecto a un repositorio Git e impórtalo en Vercel.
2. Configura `npm run build` como comando de compilación y `dist` como directorio de salida.
3. En **Project Settings → Environment Variables**, configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`, y vuelve a desplegar.
4. En Supabase, agrega el dominio de Vercel a las URL permitidas y configura la URL de producción.
5. Aplica la migración y despliega la Edge Function usando Supabase CLI desde un entorno de operador confiable.

La clave `service_role` omite RLS: mantenla exclusivamente en los secretos del entorno de Edge Functions. Si se agregan tablas con información de clientes, activa RLS y limita las operaciones a usuarios activos autorizados.
