// /api/espn  -- server-side fetch of FIFA World Cup results from ESPN's public API.
// Returns finished matches so the commissioner can auto-fill winners.

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  try {
    const url = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260720&limit=300";
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const j = await r.json();
    const out = (j.events || []).map(ev => {
      const c = ev.competitions && ev.competitions[0];
      if (!c || !c.competitors || c.competitors.length < 2) return null;
      const t1 = c.competitors[0], t2 = c.competitors[1];
      const completed = !!(ev.status && ev.status.type && ev.status.type.completed);
      let winner = null;
      if (completed){
        if (t1.winner) winner = t1.team.displayName;
        else if (t2.winner) winner = t2.team.displayName;
      }
      return {
        a: t1.team && t1.team.displayName,
        b: t2.team && t2.team.displayName,
        aScore: t1.score, bScore: t2.score,
        completed, winner, date: ev.date
      };
    }).filter(Boolean);
    res.status(200).json({ events: out });
  } catch (e){
    res.status(200).json({ events: [], error: String(e && e.message || e) });
  }
};
