# 🟢 WhatsApp CRM - ROTAR

Sistema completo de administración de WhatsApp con bot automático, catálogo de productos y campañas de publicidad masiva.

## ⚡ Instalación Rápida (Windows)

### Opción 1: Instalación desde carpeta
1. **Copia** toda la carpeta `WHATSAPP-ROTAR` en cualquier PC con Windows
2. **Doble-clic** en `INSTALAR.bat`
3. El instalador configurará todo automáticamente:
   - ✅ Descarga e instala Node.js si no lo tienes
   - ✅ Instala las dependencias
   - ✅ Crea un acceso directo en tu Escritorio

### Opción 2: Uso directo (si ya tienes Node.js)
1. Doble-clic en `INICIAR.bat`
2. Se abrirá tu navegador automáticamente en `http://localhost:3008`

---

## 🚀 Uso Diario

| Acción | Cómo |
|--------|------|
| **Iniciar** | Doble-clic en `INICIAR.bat` o el acceso directo del escritorio |
| **Detener** | Cierra la ventana negra o ejecuta `DETENER.bat` |
| **Abrir Panel** | Navega a `http://localhost:3008` en tu navegador |

---

## 📱 Primera Conexión

1. Abre el sistema en tu navegador
2. Ve a **Configuración** (⚙️)
3. Escanea el **código QR** con tu WhatsApp:
   - Abre WhatsApp en tu teléfono
   - Toca **⋮ Menú** → **Dispositivos vinculados**
   - Toca **Vincular un dispositivo**
   - Escanea el QR que aparece en la pantalla

---

## 🎯 Funcionalidades

### 💬 Gestión de Chats
- Todos los mensajes de WhatsApp en un solo panel
- Filtros: Activos, Pendientes, Archivados
- Búsqueda de conversaciones
- Respuestas rápidas con atajos (`/saludo`, `/horario`, etc.)

### 🤖 Bot Automático
- Responde automáticamente cuando no estás disponible
- Configura reglas por palabras clave, frases o regex
- Mensaje fuera de horario personalizable
- Horario de atención configurable

### ✅ Tareas
- Programa tareas de seguimiento para clientes
- Recordatorios automáticos
- Prioridades: Urgente, Alta, Normal, Baja

### 📦 Catálogo de Productos
- Crea tu catálogo con precios, fotos y stock
- Envía productos individuales por WhatsApp con un clic
- Envía el catálogo completo

### 📢 Publicidad Masiva
- Crea campañas de marketing
- Filtra destinatarios por tags
- Programa envíos automáticos
- Anti-spam con delays inteligentes

### 👥 Gestión de Clientes
- Base de datos automática de contactos
- Archiva clientes atendidos
- Bloquea contactos no deseados
- Notas y tags personalizados

---

## 📁 Archivos del Sistema

| Archivo | Descripción |
|---------|-------------|
| `INSTALAR.bat` | 🔧 Instalador automático (ejecutar una vez) |
| `INICIAR.bat` | 🚀 Lanzador del sistema |
| `DETENER.bat` | 🔴 Detener el servidor |
| `server.js` | Servidor principal |
| `whatsapp.js` | Motor de WhatsApp |
| `database.js` | Base de datos |
| `public/` | Interfaz web |
| `data/` | Datos y sesión (no borrar) |

---

## ⚠️ Notas Importantes

- **No borres** la carpeta `data/` → contiene tu sesión de WhatsApp y la base de datos
- El sistema usa el **puerto 3008** por defecto
- La conexión de WhatsApp se mantiene entre reinicios (no necesitas escanear el QR cada vez)
- Los mensajes se guardan localmente en tu PC

---

## 🔧 Requisitos del Sistema

- Windows 10 o superior
- Conexión a Internet
- Node.js 18+ (se instala automáticamente)
- WhatsApp activo en tu teléfono
