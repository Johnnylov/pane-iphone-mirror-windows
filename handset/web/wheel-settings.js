// Shared by the settings dialog and the mirror iframe on the same origin.
const wheelSettings = {
  key: "pane-wheel-distance-percent",
  defaultPercent: 2.5,
  min: 1.5,
  max: 50,
  step: 0.1,

  readPercent() {
    const value = Number(localStorage.getItem(this.key));
    return Number.isFinite(value) && value >= this.min && value <= this.max
      ? Math.round(value * 10) / 10 : this.defaultPercent;
  },
};
