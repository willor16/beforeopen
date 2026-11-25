# beforeopen

**Mira qué ejecutará un repositorio en tu máquina antes de abrirlo.**

[English](README.md)

![Ejemplo de un análisis](docs/demo.es.svg)

Abrir una carpeta puede bastar para ejecutar código ajeno: tareas del editor, hooks de agentes de IA, servidores MCP, scripts de instalación, hooks de git. `beforeopen` lee todos esos lugares **sin ejecutar nada** y muestra qué se ejecutaría, cuándo y por qué parece peligroso.

No busca malware conocido. Dibuja el mapa de lo que un repositorio *puede ejecutar*, así que no depende de haber visto antes un ataque.

## Cómo se usa

```sh
npx beforeopen owner/repo                        # un repositorio de GitHub, sin clonarlo
npx beforeopen https://github.com/o/r/pull/12    # un pull request
npx beforeopen https://gitlab.com/grupo/repo     # cualquier servidor git
npx beforeopen ~/Downloads/prueba-tecnica        # una carpeta o un archivo ya extraído
npx beforeopen diff main rama                    # lo que agrega una rama
```

> Ejecútalo desde **fuera** de la carpeta en la que no confías. El propio `npx` lee el `.npmrc` y el `node_modules` de la carpeta actual. Mejor aún, instálalo una vez: `npm install -g beforeopen`.

Necesita Node 20 o posterior y git. No tiene dependencias en tiempo de ejecución, scripts de instalación, telemetría ni cuentas.

| Código de salida | Significado |
| --- | --- |
| 0 | Nada que alcance `--fail-on` (por defecto, `high`) |
| 1 | Algo que alcanza `--fail-on` |
| 2 | Error, o algo no se pudo analizar |

`--json` da un formato estable para otras herramientas. `--all` muestra los hallazgos de gravedad baja. `--help` lo lista todo.

## En cada pull request

Un análisis suelto es útil. Un aviso cuando alguien agrega una forma nueva de ejecutar código es mejor:

```yaml
# .github/workflows/beforeopen.yml
name: beforeopen
on: pull_request
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 2
          persist-credentials: false
      - uses: willor16/beforeopen@v0   # mejor: fija el hash completo de un commit
        with:
          lang: es
```

Informa solo de lo que el pull request **agrega o cambia**, incluidos los cambios en scripts que se ejecutan al instalar. No necesita token ni secretos, así que es seguro con forks. Usa `pull_request`, nunca `pull_request_target`.

## Qué revisa

| Momento | Lugares |
| --- | --- |
| Abrir en un editor | Tareas, ajustes y espacios de trabajo de VS Code, tareas de inicio de JetBrains, Vim, Emacs, Zed, MSBuild |
| Abrir con un agente de IA | Hooks, comandos auxiliares, permisos y redirección de tráfico en Claude Code, Cursor, Codex, Gemini CLI, Copilot, Windsurf, Kiro y Opencode. Servidores MCP. Instrucciones y skills con texto oculto |
| Entrar en la carpeta | direnv, mise, autoenv |
| Usar git | Hooks, `.git/config`, repositorios ocultos dentro de otros, submódulos, husky, lefthook, pre-commit |
| Abrir en un contenedor | Comandos del contenedor de desarrollo y acceso a tu máquina |
| Instalar | npm, pnpm, Yarn, Bun, node-gyp, pip, setup.py, Composer, CocoaPods, registros |
| Compilar o probar | Cargo, Gradle, Maven, pytest, configuración que es código |

Cada comando se sigue hasta los scripts del repositorio que ejecuta. En ellos se buscan descargas que se ejecutan, robo de claves, código oculto u ofuscado, persistencia y más.

## Cómo se protege

Un analizador de repositorios hostiles también es un objetivo:

- Los archivos se leen. No se ejecuta, instala ni extrae nada.
- Git nunca lee la configuración del repositorio analizado. Corre en uno vacío creado para el análisis, porque ajustes como `core.fsmonitor` inician programas.
- Git se localiza por su ruta absoluta, así que un `git.exe` plantado en la carpeta o en su `node_modules` no se usa.
- Los trucos con mayúsculas, puntos finales, enlaces simbólicos, UTF-16 y caracteres invisibles no esconden un archivo.
- La salida se limpia: un repositorio no puede controlar tu terminal, tu resumen de GitHub ni el ejecutor.
- Lo que no se puede analizar se informa, y el código de salida lo refleja.

## Qué no puede hacer

- **Nunca dice que un repositorio es seguro.** Cualquier código puede ser peligroso cuando lo ejecutas.
- No analiza tus dependencias, solo cómo las pide el repositorio.
- No alcanza los archivos binarios ni el código que se construye al ejecutarse. Un script muy disfrazado puede evitar las señales, pero el punto de ejecución se lista igual.
- Los resultados dependen de tus versiones y ajustes. Muchas herramientas piden confianza antes, y el informe lo indica.

¿Cuánto ruido hace? El 25 de noviembre de 2026 se ejecutó en 40 repositorios populares que no se habían usado para ajustar las reglas: se analizaron 39 (una descarga agotó el tiempo) y 2 tuvieron un hallazgo alto, ambos en scripts legítimos. Tras ajustar las reglas con esos resultados, la versión 0.1.0 da un hallazgo alto en 1 de 80 repositorios. No se ha medido contra una colección de ataques reales.

## Agrega una regla

Las reglas son YAML y no hace falta conocer el código. Esta está completa:

```yaml
points:
  - id: editor/example
    trigger: editor
    severity: low
    title: { en: Example script, es: Script de ejemplo }
    files: ['**/.example/start.sh']
```

Mira [CONTRIBUTING.md](CONTRIBUTING.md) (en inglés). Para avisar de una forma de ejecutar código que pasa desapercibida, mira [SECURITY.md](SECURITY.md).

## Licencia

[MIT](LICENSE). El paquete incluye [código de terceros](THIRD-PARTY-NOTICES.md).
