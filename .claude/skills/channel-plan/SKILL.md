---
name: channel-plan
description: Build a UV-5R channel plan JSON for a location by researching RepeaterBook, NOAA Weather Radio, GMRS and public safety listings with a small set of subagents, then writing the result to `channels.json` in the shape of `channels.example.json`. Use when the user names a town, county, trailhead or region and asks for a channel plan, local repeaters, a channels.json, frequencies to program, or what to listen to there.
---

# channel-plan

Takes a location and writes `channels.json` at the repo root, shaped like the reference
`channels.example.json`. `channels.json` is ignored by git, so scripts read a fixed path and
each run replaces the previous plan. The plan feeds `uv5r tune` one channel at a time
through the `uv5r` skill.

## Steps

1. Resolve the location to a town, county, state, and approximate latitude and longitude.
   Ask the human once if the name is ambiguous. Use today's date in the plan name.
2. Launch the three subagents below in one message so they run together. Give each the
   resolved location, the radius, and the return format.
3. Compile the plan from their reports. Write it to `channels.json` in the repo root,
   overwriting any existing file. Use another path only when the human names one.
4. Report the file path, the channel list in one line each, and any entry the subagents
   flagged as unverified.

Keep the suite at three subagents. Add a fourth only when the human asks for a band or
service the three do not cover.

## Subagents

Use `general-purpose` for each. Each report is a JSON array of candidate channels with the
fields in "Candidate format" plus a `source` URL and a `confidence` of `listed`, `inferred`
or `unverified`. Tell each agent to fetch pages with WebFetch, to fall back to WebSearch
when a page needs a form, and to return at most 12 candidates.

### RepeaterBook

Run RepeaterBook as its own subagent. Brief:

- Search repeaterbook.com for amateur repeaters within 40 km of the location on 2 m
  (144-148 MHz) and 70 cm (420-450 MHz). Use the state and county pages, then the
  nearby-repeater search on the location's coordinates.
- Return output frequency as `rxMhz`, input minus output as `offsetMhz`, uplink tone as
  `tone`, callsign, sponsor, city, operational status, and the distance.
- Drop repeaters marked off air. Mark repeaters with no update in 3 years `unverified`.
- Prefer open repeaters with wide coverage, linked systems, and repeaters that host a
  weekly net. Note the net day and time when the listing shows one.

### Weather and calling

Brief:

- Read the NOAA Weather Radio station list for the state at weather.gov/nwr and find the
  transmitters that cover the location. Return each as `rxMhz` with the station callsign
  and transmitter site in `notes`.
- Include the national FM calling frequencies 146.520 and 446.000 as simplex fallbacks.
- Include the MURS channels 151.820, 151.880, 151.940, 154.570 and 154.600 when the human
  asked for license-free options.

### GMRS and public safety

Brief:

- Search mygmrs.com for GMRS repeaters within 40 km. Return the output frequency as
  `rxMhz`, `offsetMhz` 5.0, the tone, callsign and status. Include GMRS 20, 462.675, as the
  traveler assistance channel.
- Read the RadioReference county page for the location. Return conventional FM
  frequencies for the sheriff, fire, EMS and search and rescue. Skip anything marked P25,
  DMR, NXDN, encrypted or trunked. Set `rxOnly: true` on each sheriff, fire, EMS and SAR
  entry.

## Candidate format

```json
{ "name": "BIG SKY", "rxMhz": 146.820, "offsetMhz": -0.6, "tone": "82.5", "narrow": false,
  "notes": "Big Sky 2 m repeater", "source": "https://...", "confidence": "listed" }
```

`name` is at most 7 characters, upper case; the radio truncates longer names. `rxOnly` true
marks a receive-only channel; PTT does nothing on it. Omit `offsetMhz` for simplex, `tone`
when none, `narrow` and `rxOnly` when false.

## Compiling the plan

Match the reference `channels.example.json`: a top-level `name`, a top-level `notes`, and a
`channels` array. Each entry carries `channel`, `name`, `rxMhz`, and `notes`, plus
`offsetMhz`, `tone`, `narrow` and `rxOnly` when they apply. Drop `source` and `confidence`
from the entries; put unverified items in the top-level `notes`. Give an `rxOnly` entry no
`offsetMhz`; `tune` rejects the pair.

Order the channels:

1. NOAA transmitters, nearest first.
2. The best amateur repeater, then one or two alternates.
3. 146.520 as the simplex fallback.
4. GMRS 20 and any GMRS repeater.
5. Public safety receive-only channels.
6. MURS and FRS when requested.

Number channels from 1 with no gaps. Keep the plan under 16 channels so the human can scan
it on the display. Set `narrow` true for FRS, MURS 1-3 and any 12.5 kHz public safety
listing.

Write the top-level `notes` in the voice of the reference: which channels need an amateur
or GMRS license to transmit, which channel to try first for a call for help, and the date
the plan was researched.

Frequencies stay in MHz as numbers with three or four decimals. Tones are strings such as
`"82.5"` or `"D023"`. Reject anything outside 136-174 or 400-520 MHz, since the radio cannot
tune it.

## Writing the plan to the radio

Load the `uv5r` skill. Each entry goes to its own `channel` number through one `tune` call.
Pass `--rx-only` when `rxOnly` is true.

```sh
uv5r tune <rxMhz> --channel <channel> [--offset <offsetMhz>] [--tone <tone>] [--narrow] [--rx-only] --name "<name>"
```

Programming another slot does not select it on the radio. The human turns the knob to it.
