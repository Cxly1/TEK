/**
 * Clave PUBLICA con la que TEK comprueba que una actualizacion la firmo quien
 * publica TEK, y no cualquiera que llegue a la cuenta (o al token) de GitHub.
 *
 * La genera UNA vez `node scripts/release-key.mjs`, que reescribe este archivo.
 * La privada vive cifrada con contrasena en %USERPROFILE%\.tek-release y NUNCA
 * en el repo. Cada instalador se firma con `node scripts/sign-update.mjs` y su
 * `.sig` se sube a la release junto al .exe (ver Updater.verifyOwnSignature).
 *
 * Vacia = todavia no hay clave: TEK no puede comprobar nada (como hasta ahora).
 */
export const UPDATE_PUBLIC_KEY = ''
