// Konfigurace jedné "tabule" — do budoucna půjde snadno rozšířit na víc dvojic zastávek.
const BOARD_CONFIG = {
  fromLabel: "Zelený pruh",
  toLabel: "Poliklinika Budějovická",
  // GTFS stop_id obou stanovišť zastávky Zelený pruh (odkud se odjíždí)
  stopIds: ["U910Z1P", "U910Z2P"],
  // Povolené kombinace linka + cílová tabule, které skutečně jedou přímo
  // na Polikliniku Budějovickou. Zjištěno z GTFS jízdních řádů PID (stav 09/2026).
  // Pozor: pokud ROPID změní linkové vedení, je potřeba tenhle seznam ručně
  // přegenerovat ze staženého PID_GTFS.zip (viz README, sekce "Aktualizace linek").
  allowed: [
    { route: "114", headsign: "Šeberák" },
    { route: "134", headsign: "Podolská vodárna" },
    { route: "134", headsign: "Poliklinika Budějovická" },
    { route: "914", headsign: "Poliklinika Budějovická" },
    { route: "914", headsign: "Vinoř" }
  ]
};

const REFRESH_MS = 20000;
const TICK_MS = 1000;
