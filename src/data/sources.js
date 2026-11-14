// Source catalog (GDD §10). category: observed | reference | model | game.
// acquisition: bundled | cache | fetched | synthetic. No network access from the simulation.

export const SOURCES = [
  { id: 'SRC_CHALLENGE', title: 'NASA Space Apps 2026 — Build a Junior Astronaut Mission Trainer', publisher: 'NASA Space Apps', sourceURL: 'https://www.spaceappschallenge.org/2026/challenges/junior-astronaut-mission-trainer/', category: 'reference', acquisition: 'bundled', limitations: 'src.lim.challenge' },
  { id: 'SRC_HACKATHLONE', title: 'Junior Astronaut Mission Trainer — копия задания (HackAthlone)', publisher: 'HackAthlone', sourceURL: 'https://hackathlone.com/challenges/junior-astronaut-mission-trainer', category: 'reference', acquisition: 'bundled', limitations: 'src.lim.copy' },
  { id: 'SRC_NASA_API', title: 'NASA Open APIs', publisher: 'NASA', sourceURL: 'https://api.nasa.gov/', category: 'reference', acquisition: 'bundled', limitations: 'src.lim.api' },
  { id: 'SRC_DONKI', title: 'CCMC DONKI', publisher: 'NASA GSFC CCMC', sourceURL: 'https://ccmc.gsfc.nasa.gov/tools/DONKI/', category: 'observed', acquisition: 'bundled', limitations: 'src.lim.donki' },
  { id: 'SRC_OSDR', title: 'NASA OSDR', publisher: 'NASA', sourceURL: 'https://osdr.nasa.gov/bio/repo/', category: 'reference', acquisition: 'bundled', limitations: 'src.lim.osdr' },
  { id: 'SRC_RADLAB', title: 'OSDR RadLab', publisher: 'NASA', sourceURL: 'https://visualization.osdr.nasa.gov/radlab/gui/data-api/', category: 'observed', acquisition: 'bundled', limitations: 'src.lim.radlab' },
  { id: 'SRC_TREK', title: 'NASA Mars Trek', publisher: 'NASA JPL', sourceURL: 'https://trek.nasa.gov/mars/', category: 'reference', acquisition: 'bundled', limitations: 'src.lim.trek' },
  { id: 'SRC_CSA_STEM', title: 'CSA — resources for STEM and youth organizations', publisher: 'Canadian Space Agency', sourceURL: 'https://www.asc-csa.gc.ca/eng/youth-educators/resources-stem-and-youth-organizations.asp', category: 'reference', acquisition: 'bundled', limitations: 'src.lim.csa' },
  { id: 'SRC_CSA_FOOD', title: 'CSA — Food production toolkit', publisher: 'Canadian Space Agency', sourceURL: 'https://www.asc-csa.gc.ca/eng/youth-educators/toolkits/food-production/', category: 'reference', acquisition: 'bundled', limitations: 'src.lim.csa' },
  { id: 'SRC_ECLSS', title: 'Environmental Control and Life Support Systems (ECLSS)', publisher: 'NASA', sourceURL: 'https://www.nasa.gov/reference/environmental-control-and-life-support-systems-eclss/', category: 'reference', acquisition: 'bundled', limitations: 'src.lim.eclss' },
  { id: 'SRC_MOXIE', title: 'MOXIE — Mars Oxygen ISRU Experiment', publisher: 'NASA', sourceURL: 'https://www.nasa.gov/space-technology-mission-directorate/tdm/mars-oxygen-in-situ-resource-utilization-experiment-moxie/', category: 'reference', acquisition: 'bundled', limitations: 'src.lim.moxie' },
  { id: 'SRC_MELISSA', title: 'MELiSSA — Closed Loop Concept', publisher: 'ESA', sourceURL: 'https://www.esa.int/Enabling_Support/Space_Engineering_Technology/Melissa/Closed_Loop_Concept', category: 'reference', acquisition: 'bundled', limitations: 'src.lim.melissa' },
  { id: 'SRC_MARS_FACTS', title: 'Mars Facts', publisher: 'NASA Science', sourceURL: 'https://science.nasa.gov/mars/facts/', category: 'reference', acquisition: 'bundled', limitations: 'src.lim.none' },
  { id: 'SRC_WATER', title: 'Water Recovery Systems', publisher: 'NASA Ames', sourceURL: 'https://www.nasa.gov/ames/space-biosciences/water-recovery-systems/', category: 'reference', acquisition: 'bundled', limitations: 'src.lim.none' },
  { id: 'SRC_DUST', title: '10 Things: Dust in the Wind on Mars and Well Beyond', publisher: 'NASA Science', sourceURL: 'https://science.nasa.gov/solar-system/planets/mars/10-things-dust-in-the-wind-on-mars-and-well-beyond/', category: 'reference', acquisition: 'bundled', limitations: 'src.lim.none' },
  { id: 'SRC_CURIOSITY_2024', title: 'Curiosity sees specks caused by 2024 solar storm', publisher: 'NASA Photojournal', sourceURL: 'https://science.nasa.gov/photojournal/curiosity-sees-specks-caused-by-2024-solar-storm-while-recording-a-wind-gust-on-mars/', category: 'observed', acquisition: 'bundled', limitations: 'src.lim.rad' },
  { id: 'SRC_STORM_2024', title: 'What NASA is learning from the biggest geomagnetic storm in 20 years', publisher: 'NASA Science', sourceURL: 'https://science.nasa.gov/science-research/heliophysics/what-nasa-is-learning-from-the-biggest-geomagnetic-storm-in-20-years/', category: 'observed', acquisition: 'bundled', limitations: 'src.lim.rad' },
  { id: 'SRC_VEGGIE', title: 'Veggie fact sheet', publisher: 'NASA', sourceURL: 'https://science.nasa.gov/wp-content/uploads/2023/04/veggie_fact_sheet_508.pdf', category: 'reference', acquisition: 'bundled', limitations: 'src.lim.iss' },
  { id: 'SRC_RADISH', title: 'Astronauts harvest radish crop on ISS', publisher: 'NASA', sourceURL: 'https://www.nasa.gov/missions/station/astronauts-harvest-radish-crop-on-international-space-station/', category: 'reference', acquisition: 'bundled', limitations: 'src.lim.iss' },
  { id: 'SRC_SWIM', title: 'SWIM map shows subsurface water ice on Mars', publisher: 'NASA', sourceURL: 'https://science.nasa.gov/resource/swim-map-shows-subsurface-water-ice-on-mars/', category: 'reference', acquisition: 'bundled', limitations: 'src.lim.none' },
  { id: 'SRC_FSP', title: 'Fission Surface Power', publisher: 'NASA', sourceURL: 'https://www.nasa.gov/exploration-systems-development-mission-directorate/fission-surface-power/', category: 'reference', acquisition: 'bundled', limitations: 'src.lim.fsp' },
  { id: 'SRC_SURFACE_OPS', title: 'Mars Surface Operations (Architecture study, 2022)', publisher: 'NASA NTRS', sourceURL: 'https://ntrs.nasa.gov/api/citations/20220000589/downloads/MarsSAC21SurfaceOps_2022-Jan_Version%201%20FINAL_update.pdf', category: 'reference', acquisition: 'bundled', limitations: 'src.lim.none' },
  { id: 'SRC_GAME', title: 'MARS: Survival Ecosystem — CONFIG mars-config-0.1.0', publisher: 'Команда проекта', sourceURL: 'MARS-GDD.md', category: 'game', acquisition: 'synthetic', limitations: 'src.lim.game' },
];

// Archived records bundled with the build (GDD §10). Snapshot date: 2026-11-14.
export const ARCHIVE = [
  {
    id: 'OBS_FLR_20240514', sourceId: 'SRC_DONKI', type: 'FLR', category: 'observed', acquisition: 'bundled',
    recordId: '2024-05-14T16:46:00-FLR-001', peakUTC: '2024-05-14T16:51Z', classType: 'X8.7', instrument: 'GOES-P: EXIS 1.0-8.0',
    retrievedUTC: '2026-11-14', queryURL: 'https://ccmc.gsfc.nasa.gov/DONKI-API/get/FLR?startDate=2024-05-14&endDate=2024-05-14',
    noteKey: 'arch.flr.note',
  },
  {
    id: 'OBS_RAD_20240520', sourceId: 'SRC_CURIOSITY_2024', type: 'RAD', category: 'observed', acquisition: 'bundled',
    platform: 'Curiosity / RAD', place: 'Mars surface (Gale)', dateUTC: '2024-05-20', metric: 'absorbed dose (estimate)', value: 8100, unit: 'µGy',
    retrievedUTC: '2026-11-14', extraSourceId: 'SRC_STORM_2024', noteKey: 'arch.rad.note',
  },
];

// Science cards (GDD §10): unlocked by sol. label: provenance of the statement.
export const CARDS = [
  { id: 'C01', sol: 1, label: 'reference', sources: ['SRC_MARS_FACTS'] },
  { id: 'C03', sol: 3, label: 'reference', sources: ['SRC_ECLSS'], gameNote: true },
  { id: 'C05', sol: 5, label: 'reference', sources: ['SRC_ECLSS'] },
  { id: 'C06', sol: 6, label: 'reference', sources: ['SRC_WATER'] },
  { id: 'C08', sol: 8, label: 'reference', sources: ['SRC_DUST'], gameNote: true },
  { id: 'C13', sol: 13, label: 'observed', sources: ['SRC_CURIOSITY_2024', 'SRC_DONKI'], archive: ['OBS_FLR_20240514', 'OBS_RAD_20240520'], gameNote: true },
  { id: 'C14', sol: 14, label: 'reference', sources: ['SRC_VEGGIE', 'SRC_RADISH', 'SRC_CSA_FOOD'], gameNote: true },
  { id: 'C18', sol: 18, label: 'reference', sources: ['SRC_SWIM'], gameNote: true },
  { id: 'C21', sol: 21, label: 'model', sources: ['SRC_FSP'], gameNote: true },
  { id: 'C25', sol: 25, label: 'reference', sources: ['SRC_SURFACE_OPS'] },
  { id: 'CMOXIE', sol: 31, label: 'reference', sources: ['SRC_MOXIE'] },
  { id: 'CMELISSA', sol: 31, label: 'reference', sources: ['SRC_MELISSA'] },
];

export const sourceById = (id) => SOURCES.find((s) => s.id === id);
export const archiveById = (id) => ARCHIVE.find((s) => s.id === id);
