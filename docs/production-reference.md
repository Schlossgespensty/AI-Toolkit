# Production references and game observations

The reference calculator uses Merepatra's **Living by numbers** articles on
Stronghold Heaven. They report approximate observations of original Stronghold,
not extracted Crusader timers. Do not describe these as exact Crusader cycles.
One game month is converted to 800 ticks using the editor's existing calendar.

| Good | Reference work ticks | Walking tiles/month | Treatment |
| --- | ---: | ---: | --- |
| Wood | 2400 | 33⅓ | Three resource round trips plus one stockpile round trip |
| Iron | 1600 | 33 | Extraction and delivery run concurrently; slower stage limits throughput |
| Pitch | 1600 | 50 | Work plus stockpile return journey |
| Cheese | 1600 | 50 | Additional 2400 startup ticks for first batch |
| Apples | 2400 | 50 | One batch per reference harvest; does not model adjacent-orchard picking |
| Wheat | 1200 | 33⅓ | Average per load over an 18-month, 12-load harvest |
| Hops | 2600 | 50 | Average per load over a 13-month, four-load harvest |
| Stone | 480 | 33⅓ | Per stone at quarry; excludes ox haulage and stockpile arrival |
| Meat | unknown | unknown | No fabricated default or numerical output |

Farms have growth, harvesting and spoilage phases. Averaging them is useful for
rough long-run comparison, but it does **not** predict the first delivery or
the inventory at a short build step. Stockpile inventory also depends on input
consumption, trade, losses, staffing and actual walkable routes. No such result
is inferred from the reference totals.

The workshop itinerary calculator separates each one-way leg. Bows have two
stockpile round trips and one armoury round trip; crossbows have three and one.
The other weapons use their documented combined armoury-to-stockpile journey.
Tanners collect a cow once per three armour deliveries. Approximate or unknown
work times remain explicitly labelled. Modifications to worker behavior (such
as UCP's fletcher return-path changes) require game observations; they are not
silently applied to the original-game reference itinerary.

Sources (read 2026-09-12):

- [Food sources](https://stronghold.heavengames.com/strategy/production1/)
- [Food processing](https://stronghold.heavengames.com/strategy/production2/)
- [Industry](https://stronghold.heavengames.com/strategy/production3/)
- [Arms and armour](https://stronghold.heavengames.com/strategy/production4/)
- [Walking speeds](https://stronghold.heavengames.com/strategy/production5/)

The data model keeps reference timing separate from UCP delivery amounts.
Stone's rebalancer delivery amount is an ox load, so it must not multiply
quarry extraction. Walking distances default to 25 tiles, with 5 more for each
additional producer. These are user assumptions and cannot replace game paths.
