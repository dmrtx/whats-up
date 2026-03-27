# WhatsApp Web Reference Notes

Referencia analizada: [`/.whatsapp-web`](../.whatsapp-web)

## Que es esta referencia

La carpeta `.whatsapp-web` contiene una copia de `whatsapp-web.js`, una libreria Node.js que automatiza WhatsApp Web usando Puppeteer e inyecciones sobre modulos internos del cliente web.

No es una extension de navegador como `WhatsappImprover`. Su arquitectura y su nivel de acceso son mucho mas profundos.

## Lo mas util que podemos aprender

### 1. Separar capacidades por capas

La referencia esta organizada en capas claras:

- `src/Client.js`: ciclo de vida, bootstrap e inicializacion
- `src/authStrategies/*`: estrategias de autenticacion
- `src/webCache/*`: compatibilidad por version y cache
- `src/util/Injected/*`: adaptadores para APIs internas de WhatsApp Web
- `src/structures/*`: modelos de dominio (`Message`, `Chat`, `Contact`, etc.)

Aplicado a nuestra app:

- separar en modulos la deteccion de UI, acciones de mensajes, navegacion, GIFs, rendimiento y panel lateral
- dejar de crecer todo en un solo `content.js`
- introducir adaptadores pequeños por feature en vez de mezclar estado, DOM y atajos en la misma unidad

### 2. Tener una capa de compatibilidad con WhatsApp Web

La referencia asume que WhatsApp cambia seguido y por eso centraliza compatibilidad en funciones utilitarias e inyecciones versionadas.

Aplicado a nuestra app:

- crear un modulo de compatibilidad con selectores y heuristicas por feature
- centralizar deteccion de elementos como menu contextual, composer, header y lista de mensajes
- evitar repetir `querySelector` y fallback chains dispersos por todo `content.js`

Esto nos permitiria reaccionar mas rapido cuando WhatsApp cambie el DOM.

### 3. Modelar acciones en lugar de depender solo de texto visible

Hoy la extension resuelve acciones buscando labels multilenguaje como `edit`, `reply`, `delete`, etc. Eso funciona, pero es fragil.

La referencia intenta trabajar con entidades y comandos (`openChatWindow`, `openMessageDrawer`, `forwardMessage`) en vez de solo con texto.

Aplicado a nuestra app:

- encapsular cada accion en una estrategia propia
- priorizar atributos estables cuando existan: `data-testid`, `aria-label`, iconos, rol, contexto del mensaje
- dejar el match por texto como ultimo fallback, no como camino principal

### 4. Instrumentacion y estados explicitos

La referencia emite eventos de alto nivel (`ready`, `message`, `disconnected`, `auth_failure`).

Aplicado a nuestra app:

- definir eventos internos o estados estandar para `menu_detected`, `action_started`, `action_failed`, `selector_fallback_used`, `ui_reinjected`
- reemplazar logs sueltos por una pequeña utilidad de telemetria local y depuracion
- medir donde fallan mas los shortcuts cuando WhatsApp cambia

### 5. Cachear conocimiento de la version actual

`whatsapp-web.js` tiene `LocalWebCache` y `RemoteWebCache` porque la version web impacta compatibilidad.

Aplicado a nuestra app:

- detectar y guardar heuristicas de la sesion actual
- persistir una pequena firma de compatibilidad local: selectors validos, variantes encontradas, presencia de ciertos iconos o roles
- usar esa firma para acelerar deteccion y diagnostico, no para congelar HTML

### 6. Interfaces de automatizacion reutilizables

`InterfaceController.js` agrupa acciones de interfaz en una API consistente.

Aplicado a nuestra app:

- exponer un controlador interno tipo `messageActions.openMenu(messageEl)`, `messageActions.invoke('reply')`, `chatUi.openSearch()`
- eso simplificaria tests manuales, debugging y nuevas features

## Que NO conviene copiar tal cual

### 1. Inyeccion sobre modulos internos de WhatsApp

La referencia usa llamadas como:

- `window.require('WAWebCmd')`
- `window.require('WAWebCollections')`
- `window.require('WAWebSocketModel')`

Eso da mucho poder, pero para una extension es una apuesta fragil:

- depende de APIs privadas
- puede romperse sin aviso en cualquier deploy de WhatsApp Web
- aumenta el riesgo de comportamiento detectables o no soportados

Para `WhatsappImprover`, conviene seguir priorizando integracion DOM y simulacion de interacciones reales del usuario.

### 2. Automatizacion tipo bot

La referencia esta pensada para enviar, recibir y automatizar mensajes. Nuestra app es una mejora de UX local en el navegador.

No conviene mezclar ambos enfoques porque:

- cambia el riesgo del producto
- complica permisos y mantenimiento
- abre preguntas de cumplimiento que hoy no tenemos

### 3. Cachear HTML completo por version

Eso tiene sentido para Puppeteer y bootstrap profundo. En una extension probablemente sea sobreingenieria.

Nos sirve mas cachear metadatos de compatibilidad que snapshots completos del cliente.

## Mejoras concretas para priorizar en nuestra app

1. Extraer `content.js` en modulos:
   - `compat/selectors.js`
   - `actions/message-actions.js`
   - `features/gif-picker.js`
   - `features/navigation.js`
   - `features/performance.js`
   - `ui/sidebar-widget.js`

2. Crear una capa `WhatsAppDomAdapter`:
   - `findContextMenu()`
   - `findMenuItems(menu)`
   - `findComposer()`
   - `findVisibleMessages()`
   - `findSidebarHeader()`

3. Rehacer resolucion de acciones con prioridad:
   - selector estable
   - icono/aria/rol
   - contexto del item
   - texto multilenguaje como fallback final

4. Definir un registro de capacidades:
   - `canReply`
   - `canEdit`
   - `canDeleteForEveryone`
   - `canPin`
   - `supportsGifCommand`

5. Agregar diagnostico local:
   - modo debug configurable
   - contador de fallbacks usados
   - ultimo selector valido por feature

6. Preparar una small compatibility matrix:
   - menu contextual detectado por `role`
   - menu contextual detectado por `data-animate-dropdown`
   - composer detectado por `contenteditable`
   - header detectado por `data-testid`

## Siguiente paso recomendado

El siguiente paso con mejor retorno es refactorizar `content.js` hacia una capa `WhatsAppDomAdapter` y una capa `MessageActionResolver`.

Eso reutiliza la mejor leccion de la referencia: separar compatibilidad, interfaz y acciones. Tambien reduce el costo de mantener la extension cuando WhatsApp Web cambie su DOM.
