# Configuración del panel privado

El panel y las funciones de reservas necesitan Supabase y Google Calendar antes de desplegarse. No compartas contraseñas, claves de servicio, secretos OAuth ni tokens en el chat o en el código del navegador.

## 1. Preparar Supabase

1. Crea un proyecto en Supabase.
2. En **SQL Editor**, ejecuta el contenido de `supabase/schema.sql`.
3. En **Project Settings → API**, copia la URL del proyecto y la clave `service_role`. Esta clave es secreta y debe usarse solo como variable de servidor en Vercel.

## 2. Preparar Google Calendar

1. En Google Cloud, crea o selecciona un proyecto y habilita **Google Calendar API**.
2. Configura la pantalla de consentimiento OAuth y agrega la cuenta del dueño como usuario de prueba si la aplicación está en modo de pruebas.
3. Crea un **OAuth Client ID** de tipo **Web application**.
4. Agrega esta URI exacta como URI de redirección autorizada:

   `https://andrews-car-wash-2.vercel.app/api/google-auth`

5. Guarda el Client ID y el Client Secret para agregarlos a Vercel.
6. El dueño puede usar el calendario principal o crear un calendario dedicado. Copia el ID del calendario elegido desde sus ajustes.

## 3. Variables de entorno de Vercel

En el proyecto **andrews-car-wash-2**, abre **Settings → Environment Variables** y agrega:

| Variable | Valor |
| --- | --- |
| `APP_URL` | `https://andrews-car-wash-2.vercel.app` |
| `ADMIN_EMAIL` | El correo de Google autorizado del dueño |
| `ADMIN_SESSION_SECRET` | Secreto aleatorio de al menos 32 caracteres; puedes generarlo con `openssl rand -base64 32` |
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave `service_role` de Supabase |
| `GOOGLE_CLIENT_ID` | Client ID OAuth |
| `GOOGLE_CLIENT_SECRET` | Client Secret OAuth |
| `GOOGLE_REDIRECT_URI` | `https://andrews-car-wash-2.vercel.app/api/google-auth` |
| `GOOGLE_CALENDAR_ID` | ID del calendario seleccionado |

Usa los ámbitos de producción y preview necesarios. Nunca configures `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_SECRET` o `ADMIN_SESSION_SECRET` como variables públicas con prefijo `NEXT_PUBLIC_`.

## 4. Desplegar y conectar

Después de configurar las variables, vuelve a desplegar el proyecto. El dueño entra a:

`https://andrews-car-wash-2.vercel.app/admin`

Debe iniciar sesión con la cuenta indicada en `ADMIN_EMAIL` y elegir **Conectar calendario** para autorizar el acceso de Google.

## Cómo funciona

- Las solicitudes se guardan en Supabase como pendientes y también se prepara el mensaje de WhatsApp.
- Una solicitud pendiente no bloquea la agenda.
- Al aprobar una solicitud, el servidor consulta Google Calendar, crea el evento y confirma la cita. Al rechazarla, no crea evento.
- El horario configurado es lunes a sábado, de 10:00 a 18:00, con inicios cada hora entre 10:00 y 17:00, zona `America/Tijuana`.

Antes de compartir el formulario, prueba una solicitud de principio a fin y confirma que aparezca en el panel, que aprobar cree el evento y que rechazar no lo cree.
