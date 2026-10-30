# Find: where a photo was taken, from its skyline

Find is the third mode of Horizon. You trace the line of the hills in a photo, draw an
area on the map, and Find ranks the places in that area whose relief would show that
line. It is in **beta**: it is advanced and still being tuned, and not everything works
fully yet.

This page is about using it well: what Find does best, where it fails, and how to use
each of its tools. Everything in it comes from tests on 31 real photos and videos whose
place is known, and from the searches that went wrong.

## In short

- Find **ranks candidates**. It does not prove a place. Check every place it gives against
  imagery, buildings, roads and shadows.
- It reads the **relief** only: hills, ridges, mountains and the sea's horizon.
- It is at its best on a **distinctive skyline several kilometres away**.
- When it misses, it is almost always because **another place fits as well**, not because
  the search passed over the right one. Information that tells look-alikes apart is what
  fixes it.
- **A wrong mark costs more than no mark.** Leave out what you are not sure of.

## A worked example

The guide in the app (the `?`, then Horizon, Find) walks one search step by step:
*Search with Find*, on a public-domain photo of Half Dome taken from Glacier Point,
Yosemite, in 1901.

- **The trace.** The skyline in four lines (a far ridge, the Dome, the far range, a ridge
  on the right), and three ridges seen in front of farther land.
- **The marks.** The Dome as the key line. Far land hidden over the far range, pale under
  a milky sky. Distances said wide: the Dome and Liberty Cap under 10 km, the far range
  past it. The Dome looks close but stands 4 km away, so 1 to 3 km alone would have ruled
  the true place out.
- **What is known.** The camera looks down into a deep valley from its rim, so Summit or
  ridge and Slope, and above the land round. The lens looks like a camera's usual one or
  a little longer, so ×1 and ×2–3.
- **The search.** An area of about 85 km² round the valley, a point every 50 m.

Find put Glacier Point first, about 300 m from where the photographer stood, facing the
right way with nearly the right lens. The best place explained 81% of the trace and the
next 56%. With the same photo traced roughly and no marks, on a smaller area, Find also
put it first, but the next place came within a few points of it. The marks are what set
the true place apart.

*Try this search*, at the end of that walk, opens the same photo with every line and mark in
a case of its own, ready for you to press Search.

## Where Find is strong

**Far, distinctive skylines.** Peaks, notches and long ridges a few kilometres away or more
are where the terrain is sharpest, and where one place looks least like another.

**It finds the place when the trace allows it.** In our tests, when the traced line lay
well on the terrain at the true spot, Find put that spot first (within 1 km) in about half
the cases, and in the top five in three cases out of four.

**It searches thoroughly.** A missed place is rarely a point the search skipped. Most
misses are look-alikes, often 5 to 20 km away, that fit the trace as well or better.

**Collages and pans.** A collage made in Azimut is read frame by frame and needs nothing
more. The lens its stitch says is a guess from joining the frames, so Find searches it 20%
either way. On five collages in our tests, that took the number found first from none to
two, and the number in the top five from one to four.

**It says how far to trust a result.** Solid, Check it or Weak, what the area fits by
chance, and a check against decoys of your own trace (see *Reading the results*).

**It runs on your computer.** A small area takes a few minutes, and the search says the
time left once it has been running a moment. The terrain tiles are downloaded once and kept.

## Where Find fails

**The terrain model.** Find reads Copernicus GLO-30, one height every 30 m over most of
the world (finer where a national survey is published). That is precise for a ridge 10 km
away, where a cell is a fraction of a degree, and coarse for a hillside 500 m away, where a
cell spans several degrees. The model also holds part of the buildings and trees, and is
weakest on very steep slopes.

**Photos it cannot locate, or hardly:**
- Near ridges only, a few hundred metres away, especially with houses or trees on them.
- Flat horizons: a plain, low far hills, the sea's horizon alone. Many places look the same.
- Night and haze, where the visible line may not be the top of the land.
- Collages glued by hand, at night or from photos of different zooms: every piece adds doubt.
- Busy foregrounds that hide most of the skyline.

In our tests, a photo whose trace explained less than about 40% of its shape at the true
spot was never found, by any setting.

**It picks the camera on the skyline.** The ridges you trace in front of farther land
only confirm a place or lower its score; they do not choose the camera. A photo with a
short or dull skyline and clear ridges in front can be missed even though your eye sees
the match. That is the main thing we are working on.

**The same photo, traced differently, can go from found to not found.** Find answers the
trace and the marks you give it, not the photo.

**A large area meets more look-alikes** and takes longer.

## Using the tools well

### Tracing

- Trace the skyline, the edge against the sky, with **Skyline**. Be precise on peaks and
  notches: they carry most of the information.
- Trace a ridge seen in front of farther land with **Ridge**, only where you see it clearly.
- Trace the sea's horizon with **Sea line**.
- Leave out what is not land: buildings, trees, poles, smoke. **Rub out** what you are
  unsure of. A gap is better than a wrong line.
- For a video, trace the frame that shows the most horizon, and use **Measure from the
  video** to get the lens from its pan.
- For a collage made elsewhere, use **Cut** where its pieces meet.

### The marks: when they help, when they hurt

Each mark is information. Right, it helps a lot; wrong, it can make the true place
impossible to find. When you are not sure, leave it out.

| Mark | Use it when | What our tests showed |
|---|---|---|
| **Key line** | One stretch is unmistakable: a peak or a notch you would recognise anywhere. | Three at most. A key line on a dull stretch weighs it for nothing. |
| **Sky only** | You are sure nothing stands behind that line: clear sky right above it. | Not on a hazy line, where land may stand behind it unseen. |
| **Distance** | You can judge it: near hills under 1 km, far mountains over 10 km. | A far coast 40 km off, marked 1 to 10 km because it looked like a near island, made the true spot score zero. Pick several bands when unsure. |
| **Behind** | One line clearly stands in front of another. | Only for lines you see overlap. |
| **May be bent** | The edges of a wide lens, or a piece of a collage stretched when laid. | Without it, several photos lost their first place. Brush only what is really distorted. |
| **Far land hidden** | Haze or the night washes out the land behind a stretch: the line is pale, the sky above it milky. | It lifted three hazy photos from far down the list into the top five or first place. On a crisp far skyline it threw the best evidence away and cost a photo its first place. It also shortens the line the camera is fitted on: one photo fell from 13th to far down the list. |

### What you know of the photo

These sit under **Help the search**.

| Setting | Use it when | What our tests showed |
|---|---|---|
| **Taken**: Roof, and **Floors** | The photo was taken from a roof, a terrace or a high window. A floor is about 3 m. | It brought two photos into the top six. On a slope the building's foot may stand lower than the model gives, so many floors can overshoot: give fewer rather than more. |
| **Eye stands** above or below the land round | The camera clearly stood on a summit, or in a valley. | Safe: it never ruled out a true place. |
| **Camera**: Looking down or up | The skyline sits very low or very high in the frame, from a real height (a cliff, a tower, a drone). | Looking down opens steep camera angles that wrong places can use. A mountain view was missed with it, and found 135 m from the truth without it. |
| **Facing** and **Sun** | You know roughly which way the camera looked, or where the sun stood. | Among the strongest ways to rule out look-alikes. Tick the neighbouring directions when unsure. |
| **Alignments** | Two known landmarks line up in the photo. | Very strong when right. |
| **Water** | The sea or a lake shows in the photo. | Points from which no water is in sight are left out. |
| **Selfie** | The photo may be mirrored. | It searches twice, so it takes twice as long. |

### The area and the search

- Draw the area as small as your other clues allow. Several areas can be searched at once,
  and the brush turns points off where the photo cannot have been taken.
- Start with **Quick**. It lays a grid twice as wide and usually finds the region; search
  again finer around it.
- **Save** (Ctrl+S) keeps the setup in the case without searching, to come back to later.

## Reading the results

- **Solid**, **Check it** and **Weak** say how far the best place stands above what the
  area reaches by chance. Weak means look-alikes are close: treat the list as a short list.
- **Explains 80%** says how much of the trace fits there. It is a score, not a probability.
- **Try a point** says the skyline and the ridges apart. **Fit** in the view judges the
  skyline alone, so it can read higher without the place being any better.
- **Check against decoys** tries the places again with your trace mirrored and upside
  down. A real place explains its own trace far better than its decoys.
- Look at the **first five places**, not only the first. In our tests the true place was
  often second or third.
- Open a place to lay your photo over the terrain from there, the view settling on your
  trace by itself. A good match lays every peak
  and notch; a look-alike usually misses a detail somewhere. **See which lines are off**
  says by how much.
- Check by hand around it too. Move the eye a few hundred metres, and zoom the view in or
  out until the ridges meet. Your eye weighs the whole relief.
- When the place is found, confirm it: the search stops there and keeps it.
- If a place far from what you expected wins, ask what would rule it out: a direction, a
  distance, a landmark, the sun.
