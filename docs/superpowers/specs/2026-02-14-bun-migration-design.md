# Migración de npm a Bun y rename de rama `master` → `main`

Fecha: 2026-02-14
Proyecto: ligerotools (Ligero.Tools)

## Objetivo

Migrar todo el proyecto de npm a Bun como package manager y renombrar la rama por defecto de `master` a `main` (local y remota). Enfoque mínimo: no se reescribe código de la app ni se migran los tests a `bun:test`.

## Decisiones acordadas

1. **Package manager:** Bun reemplaza a npm. `package-lock.json` se elimina; se genera `bun.lock` con `bun install`.
2. **Scripts de `package.json`:** no cambian (`dev`, `build`, `lint`, `preview`). Solo se invocan con `bun run`.
3. **Tests:** primero se prueba compatibilidad de Bun con los archivos actuales (`node:test` sin reescribir). Si Bun falla, se documenta `node --test` como fallback. No se reescriben los tests.
4. **Configs de deploy:** `netlify.toml` y `vercel.json` pasan de `npm run build` a `bun run build`. Ambas plataformas soportan Bun.
5. **Rama:** rename local y remota. Se elimina `origin/master`, se crea `origin/main`, se actualiza `origin/HEAD`.
6. **Fuera de alcance:** `packageManager` pin, migración a `bun:test`, despliegue real, cambios en `src/`, `tsconfig.*`, `vite.config.ts`, `.oxlintrc.json`.

## Sección 1 — Package manager

| Actual | Propuesto |
|--------|-----------|
| `package-lock.json` | Se elimina |
| — | `bun.lock` generado con `bun install` |
| `npm ci` | `bun install --frozen-lockfile` (equivalente estricto; en el README se documenta `bun install` para setup local) |
| `npm run X` | `bun run X` |

- Se limpia `node_modules` instalado por npm antes de reinstalar con Bun.
- `.gitignore`: se añade `bun-debug.log*`; se conservan líneas existentes (npm/yarn/pnpm logs, `node_modules`).
- Verificación: `bun install` → `bun run lint` → `bun run build` pasan sin errores.

## Sección 2 — Tests

Situación actual: `compressor.test.mjs` y `platform.test.mjs` importan `node:test`, `node:assert`, `node:fs`, `node:vm`; se ejecutan con `node --test`.

Plan:

1. Probar con Bun sin reescribir: `bun --test …` / `bun test …` / `bun <archivo>`.
2. Si Bun los ejecuta correctamente → el README documenta el comando con Bun.
3. Si fallan → se mantiene `node --test` como fallback documentado en el README.

No se reescriben los tests en esta migración.

Verificación: la suite completa pasa con el runner elegido.

## Sección 3 — Docs y deploy

README — bloque de desarrollo/verificación:

```sh
bun install
bun run dev
bun run lint
bunx tsc -b
bun run build
# tests: runner resultante de la sección 2 (bun o node --test)
bun run preview
```

netlify.toml:

```toml
command = "bun run build"
```

vercel.json:

```json
"buildCommand": "bun run build"
```

Nota: no se realiza despliegue; solo se actualiza la config. Netlify/Vercel soportan Bun nativamente.

## Sección 4 — Rama `master` → `main`

Local:

```sh
git branch -m master main
```

Remota:

```sh
git push -u origin main
git push origin --delete master
git remote set-head origin -a
```

Resultado: local en `main`; `origin/main` existe; `origin/master` eliminada; `origin/HEAD` apunta a `main`. El historial no se reescribe.

El rename se hace al final, tras los cambios de código, para que el remoto reciba la migración completa.

## Sección 5 — Verificación final

1. `rm -rf node_modules && bun install` → `bun.lock` presente, `package-lock.json` ausente
2. `bun run lint` → pasa
3. `bunx tsc -b` → sin errores
4. `bun run build` → `dist/` generado
5. Tests pasan con el runner elegido
6. `bun run preview` sirve la app (smoke test)
7. `git branch -a` → solo `main`; `git status` → "On branch main"; remoto sin `master`
8. Sin restos de `npm ` en comandos de README/netlify.toml/vercel.json
9. Los cambios se commitean en `main`

## Fuera de alcance

- Código de la app (`src/`) y contenido de los tests (solo su comando de ejecución)
- `tsconfig.*`, `vite.config.ts`, `.oxlintrc.json`
- Despliegue real a Netlify/Vercel
- Migración de tests a `bun:test`
- Campo `packageManager`
