# JavaScript and JSX Migration

This repository now uses JavaScript for server code and JSX for React components.

- Application modules use `.js`
- React components and pages use `.jsx`
- Path aliases are configured in `jsconfig.json`
- `tsconfig.json` has been removed
- CI rejects new `.ts` or `.tsx` files under `src`
