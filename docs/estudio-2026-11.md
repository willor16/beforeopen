# Qué pueden ejecutar en tu máquina 1.000 repositorios populares

*Noviembre de 2026. BeforeOpen 0.1.2 leyó los 1.000 repositorios con más estrellas de GitHub sin ejecutar nada.*

**Se analizaron 994 de los 1.000.** Los otros 6 eran demasiado grandes para descargarse en diez minutos o perdieron la conexión.

## Lo más importante

1. **El 72,6% tiene algo que puede ejecutar código antes de que tú ejecutes el proyecto:** scripts de instalación, hooks de git, configuración que es código, ajustes del editor o de agentes.
2. **El 49,7% ya incluye instrucciones para agentes de IA.** El 38,2% tiene un `AGENTS.md`, el 32,3% tiene skills y el 22,8% un `CLAUDE.md`. Los agentes leen esos archivos como órdenes.
3. **El 6,3% trae hooks para agentes de IA**, comandos que se ejecutan mientras el agente trabaja, y el 4,6% trae servidores MCP que inician un programa. 10 repositorios aprueban por adelantado sus propios servidores MCP, lo que se salta la pregunta que te haría el agente.
4. **Solo 1 de 994 usa una tarea de VS Code que se ejecuta al abrir la carpeta**, y es el propio VS Code. Esa misma función es el truco favorito de las falsas entrevistas de trabajo. En un proyecto que te enviaron, es motivo para detenerse.
5. **El 37,1% ejecuta algo al instalar dependencias** y el 27,4% activa hooks de git por ti.

Nada de esto es malicioso por sí mismo. Muestra cuánto código se ejecuta antes de que alguien lo lea, y que los agentes de IA han sumado una capa nueva.

## Todos los tipos de punto de ejecución

| Qué | Repositorios | Porcentaje |
| --- | --- | --- |
| Tarea del editor que se ejecuta al abrir la carpeta | 1 | 0,1% |
| Ajuste del editor que elige un programa o relaja una protección | 13 | 1,3% |
| Instrucciones para agentes de IA | 494 | 49,7% |
| Hooks de agentes de IA | 63 | 6,3% |
| Servidores MCP que inician un programa | 46 | 4,6% |
| Servidores MCP remotos | 30 | 3% |
| Aprobación automática para agentes | 12 | 1,2% |
| Comandos dentro de prompts y skills | 37 | 3,7% |
| Scripts al entrar en la carpeta (direnv, mise) | 31 | 3,1% |
| Comando del contenedor en tu propia máquina | 7 | 0,7% |
| Comandos dentro del contenedor | 96 | 9,7% |
| Hooks de git que activa el proyecto | 272 | 27,4% |
| Scripts de npm al instalar | 224 | 22,5% |
| Pasos de instalación en otros ecosistemas | 223 | 22,4% |
| Dependencias de fuera del registro | 59 | 5,9% |
| Scripts de compilación y configuración que es código | 583 | 58,7% |
| Código que parece oculto | 47 | 4,7% |

## Los hallazgos altos fueron todos falsas alarmas

BeforeOpen marcó 53 repositorios (5,3%) como `high`. Se revisaron uno por uno a mano, mirando las líneas que los provocaron y no auditando el proyecto entero, y **ninguno parecía malicioso**:

- Proyectos de seguridad y de criptomonedas cuyo código normal se parece a un ataque: herramientas de explotación, clientes de blockchain, listas de textos peligrosos.
- Texto que solo parece un comando: instrucciones de instalación mostradas como mensaje y listas de nombres de archivo que las herramientas usan para *proteger* claves.
- Herramientas que construyen comandos codificados a propósito, para ejecutar código en un contenedor o en otra máquina.
- Scripts que instalan herramientas dentro de un contenedor de desarrollo y no tocan tu máquina.
- Decisiones de configuración que conviene conocer: proyectos que aprueban sus servidores MCP por adelantado.

Un repositorio incluye una librería de otra empresa ofuscada, de 98 KB. Su descripción dice que sirve para iniciar sesión. No se encontró ninguna señal de daño, pero el código ofuscado no se puede comprobar. No se nombra aquí.

La lección tiene que ver con la frecuencia. En un repositorio famoso, un hallazgo `high` casi siempre es una rareza legítima. En un proyecto que te envió un desconocido, el mismo hallazgo merece tu atención. El estudio también muestra de dónde viene el ruido, para poder reducirlo: scripts que solo se ejecutan dentro de contenedores y texto que aparece lejos del comando que de verdad se ejecuta.

## Método

- **Lista:** los 1.000 repositorios con más estrellas según la API de búsqueda de GitHub el 25 de noviembre de 2026. Tienen entre 35.000 y 566.000 estrellas.
- **Descarga:** solo el último commit, sin archivos de más de 8 MB. Más de 30 GB en total. No se extrajo ni se ejecutó nada.
- **Herramienta:** BeforeOpen 0.1.2, con las reglas por defecto. 989 análisis quedaron completos; el resto tenía algún archivo demasiado grande para leerlo.
- **Recuento:** cada repositorio cuenta una vez por fila, tenga los archivos que tenga.
- No se publican los resultados por repositorio, para no señalar a ningún proyecto. La lista y la herramienta son públicas, así que cualquiera puede repetirlo.

Cuánto detecta BeforeOpen de los ataques reales se mide aparte, en [detection.md](detection.md) (en inglés).
