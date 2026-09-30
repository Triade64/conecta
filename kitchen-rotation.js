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
    const taskStart = stamp(config.startDate), coffeeStart = config.coffeeStartDate ? stamp(config.coffeeStartDate) : taskStart;
    const start = Math.min(taskStart, coffeeStart), end = stamp(endDate);
    if ((end - start) / dayMs > 20000) throw new Error("Selecione uma data mais próxima do início da escala.");
    let dishCursor = Math.max(0, people.indexOf(config.startWasher));
    let sweepCursor = Math.max(0, people.indexOf(config.startSweeper));
    const coffeeGroups = config.coffeeGroups || [];
    let coffeeCursor = Math.max(0, Math.min(coffeeGroups.length - 1, Number(config.startCoffeeGroup) || 0));
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
      const dishes = time >= taskStart && (edit.dishes ?? (weekday >= 1 && weekday <= 5));
      const sweep = time >= taskStart && (edit.sweep ?? (weekday === 3));
      const coffee = time >= coffeeStart && coffeeGroups.length > 0 && (edit.coffee ?? (weekday >= 1 && weekday <= 5));
      let wash = null, dry = null, sweeper = null;
      let coffeeGroup = null, coffeePeople = null;
      if (dishes && available.length >= 2) {
        wash = manual(edit.wash) || next(dishCursor);
        dry = manual(edit.dry);
        if (!dry || dry === wash) dry = next(people.indexOf(wash) + 1, wash);
        // The person drying today is first in line to wash on the next scheduled day.
        dishCursor = people.indexOf(dry);
      }
      if (sweep && available.length) {
        sweeper = manual(edit.sweeper) || next(sweepCursor);
        sweepCursor = (people.indexOf(sweeper) + 1) % people.length;
      }
      if (coffee) {
        coffeeGroup = Number.isInteger(edit.coffeeGroup) && edit.coffeeGroup >= 0 && edit.coffeeGroup < coffeeGroups.length ? edit.coffeeGroup : coffeeCursor;
        coffeePeople = [...coffeeGroups[coffeeGroup]];
        coffeeCursor = (coffeeGroup + 1) % coffeeGroups.length;
      }
      result[date] = { date, dishes, sweep, coffee, wash, dry, sweeper, coffeeGroup, coffeePeople, absent: [...absent], note: edit.note || "", changed: !!config.days?.[date] };
    }
    return result;
  };
  const api = { generate, sortedPeople, stamp };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.conectaKitchenRotation = api;
})(typeof window !== "undefined" ? window : globalThis);
