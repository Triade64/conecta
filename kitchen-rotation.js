/* Date-only arithmetic keeps the rotation independent of browser timezone. */
((root) => {
  const dayMs = 86400000;
  const stamp = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) throw new Error("Data inválida.");
    const time = Date.parse(value + "T12:00:00Z");
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error("Data inválida.");
    return time;
  };
  const sortedPeople = names => [...new Set(names.map(name => name.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }) || a.localeCompare(b));
  const generate = (config, endDate) => {
    const people = sortedPeople(config.people || []);
    if (!config.startDate || people.length < 2) return {};
    const start = stamp(config.startDate), end = stamp(endDate);
    if ((end - start) / dayMs > 20000) throw new Error("Selecione uma data mais próxima do início da escala.");
    let dishCursor = Math.max(0, people.indexOf(config.startWasher));
    const pairs = config.sweepPairs || [];
    let sweepCursor = Math.max(0, Math.min(pairs.length - 1, Number(config.startSweepPair) || 0));
    const result = {};
    for (let time = start; time <= end; time += dayMs) {
      const date = new Date(time).toISOString().slice(0, 10);
      const weekday = new Date(time).getUTCDay();
      const edit = config.days?.[date] || {};
      const absent = new Set(edit.absent || []);
      const available = people.filter(person => !absent.has(person));
      const next = (cursor, exclude = null) => {
        for (let step = 0; step < people.length; step++) {
          const name = people[(cursor + step) % people.length];
          if (!absent.has(name) && name !== exclude) return name;
        }
        return null;
      };
      const manual = name => people.includes(name) && !absent.has(name) ? name : null;
      const dishes = edit.dishes ?? (weekday >= 1 && weekday <= 5);
      const sweep = edit.sweep ?? (weekday === 3);
      let wash = null, dry = null, sweepers = null, sweepPair = null;
      if (dishes && available.length >= 2) {
        wash = manual(edit.wash) || next(dishCursor);
        dry = manual(edit.dry);
        if (!dry || dry === wash) dry = next(people.indexOf(wash) + 1, wash);
        // The person drying today is first in line to wash on the next scheduled day.
        dishCursor = people.indexOf(dry);
      }
      if (sweep && pairs.length) {
        sweepPair = Number.isInteger(edit.sweepPair) && edit.sweepPair >= 0 && edit.sweepPair < pairs.length ? edit.sweepPair : sweepCursor;
        // Sweeping pairs are fixed. Absence does not replace either member or skip a pair.
        sweepers = [...pairs[sweepPair]];
        sweepCursor = (sweepPair + 1) % pairs.length;
      }
      result[date] = { date, dishes, sweep, wash, dry, sweepers, sweepPair, absent: [...absent], note: edit.note || "", changed: !!config.days?.[date] };
    }
    return result;
  };
  const api = { generate, sortedPeople, stamp };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.conectaKitchenRotation = api;
})(typeof window !== "undefined" ? window : globalThis);
