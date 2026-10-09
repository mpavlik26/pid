// BOARD_CONFIG se od US-6 nenastavuje natvrdo — naplní ho app.js za běhu,
// buď z uložené dvojice zastávek (localStorage), nebo po novém dopočtu přes
// connections.js. Tvar: fromLabel/toLabel/stopIds/toStopIds (od v44 bez `allowed`).
let BOARD_CONFIG = null;

const REFRESH_MS = 30000;
const TICK_MS = 1000;
