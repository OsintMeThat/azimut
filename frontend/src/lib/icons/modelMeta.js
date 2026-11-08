/**
 * What each vehicle model is called and where it is filed, without its geometry,
 * so a picker or a layer list can name a model before `models.js` has loaded.
 */

/**
 * The three views offered for a model: the tilt each sets, and the heading it is
 * shown at. Top looks straight down; Side sees the model's right flank, nose to
 * the right of the page.
 */
export const MODEL_VIEWS = [
  { id: 'top', label: 'Top', tilt: 0, heading: 0 },
  { id: 'angled', label: 'Angled', tilt: 55, heading: 130 },
  { id: 'side', label: 'Side', tilt: 84, heading: 90 },
];

/** Families in the order a picker shows them. */
export const MODEL_FAMILIES = ['Generic', 'Road', 'Armour', 'Air', 'Sea', 'Rail'];

export const MODEL_META = [
  { id: 'model-block', label: 'Any vehicle', family: 'Generic', keywords: ['vehicle', 'unknown', 'generic'] },
  { id: 'model-chevron', label: 'Heading', family: 'Generic', keywords: ['direction', 'arrow', 'movement', 'bearing'] },

  { id: 'model-car', label: 'Car', family: 'Road', keywords: ['automobile', 'sedan', 'suv'] },
  { id: 'model-pickup-plain', label: 'Pickup', family: 'Road', keywords: ['pickup', '4x4', 'ute', 'light truck', 'civilian'] },
  { id: 'model-pickup', label: 'Technical', family: 'Road', keywords: ['pickup', '4x4', 'machine gun', 'militia'] },
  { id: 'model-van', label: 'Van', family: 'Road', keywords: ['minibus', 'ambulance', 'delivery'] },
  { id: 'model-truck', label: 'Truck', family: 'Road', keywords: ['lorry', 'transport', 'logistics', 'covered'] },
  { id: 'model-tanker', label: 'Tanker', family: 'Road', keywords: ['fuel', 'bowser', 'water'] },
  { id: 'model-bus', label: 'Bus', family: 'Road', keywords: ['coach', 'transport'] },
  { id: 'model-moto', label: 'Motorbike', family: 'Road', keywords: ['motorcycle', 'scooter'] },

  { id: 'model-mrap', label: 'Armoured car', family: 'Armour', keywords: ['mrap', '4x4', 'patrol', 'armored'] },
  { id: 'model-apc', label: 'APC', family: 'Armour', keywords: ['wheeled', 'armoured', 'armored', 'personnel carrier', '8x8'] },
  { id: 'model-ifv', label: 'IFV', family: 'Armour', keywords: ['tracked', 'infantry fighting vehicle', 'armoured', 'armored'] },
  { id: 'model-tank', label: 'Tank', family: 'Armour', keywords: ['mbt', 'tracked', 'armour', 'armor'] },
  { id: 'model-spg', label: 'Artillery', family: 'Armour', keywords: ['self-propelled', 'howitzer', 'spg'] },
  { id: 'model-towed-gun', label: 'Towed gun', family: 'Armour', keywords: ['howitzer', 'field gun', 'artillery', 'cannon'] },
  { id: 'model-mlrs', label: 'Rocket launcher', family: 'Armour', keywords: ['mlrs', 'rockets', 'launcher'] },
  { id: 'model-sam', label: 'Air defence', family: 'Armour', keywords: ['sam', 'missile', 'launcher', 'air defense'] },
  { id: 'model-aa-gun', label: 'AA gun', family: 'Armour', keywords: ['anti-aircraft', 'twin', 'towed', 'flak'] },
  { id: 'model-aa-pickup', label: 'AA technical', family: 'Armour', keywords: ['anti-aircraft', 'pickup', 'twin', 'technical'] },
  { id: 'model-dozer', label: 'Engineering', family: 'Armour', keywords: ['bulldozer', 'dozer blade', 'engineer', 'earthworks'] },

  { id: 'model-heli', label: 'Helicopter', family: 'Air', keywords: ['rotor', 'aircraft'] },
  { id: 'model-fighter', label: 'Fighter', family: 'Air', keywords: ['jet', 'aircraft', 'combat'] },
  { id: 'model-transport', label: 'Transport', family: 'Air', keywords: ['airliner', 'cargo plane', 'aircraft'] },
  { id: 'model-quad', label: 'Quadcopter', family: 'Air', keywords: ['drone', 'uav', 'camera'] },
  { id: 'model-fpv', label: 'FPV drone', family: 'Air', keywords: ['drone', 'quadcopter', 'kamikaze', 'payload'] },
  { id: 'model-uav', label: 'UAV', family: 'Air', keywords: ['drone', 'reconnaissance', 'fixed-wing'] },
  { id: 'model-oneway', label: 'One-way drone', family: 'Air', keywords: ['loitering munition', 'kamikaze', 'delta', 'drone'] },

  { id: 'model-skiff', label: 'Skiff', family: 'Sea', keywords: ['boat', 'speedboat', 'small craft'] },
  { id: 'model-usv', label: 'Uncrewed boat', family: 'Sea', keywords: ['usv', 'sea drone', 'naval drone', 'surface drone'] },
  { id: 'model-warship', label: 'Warship', family: 'Sea', keywords: ['navy', 'frigate', 'destroyer', 'corvette'] },
  { id: 'model-cargo', label: 'Cargo ship', family: 'Sea', keywords: ['container', 'freighter', 'merchant'] },

  { id: 'model-locomotive', label: 'Locomotive', family: 'Rail', keywords: ['train', 'engine', 'railway'] },
  { id: 'model-wagon', label: 'Wagon', family: 'Rail', keywords: ['train', 'freight', 'railcar', 'boxcar'] },
];

const BY_ID = new Map(MODEL_META.map((entry) => [entry.id, entry]));

export const isModelId = (id) => BY_ID.has(id);
export const modelMeta = (id) => BY_ID.get(id) ?? null;
