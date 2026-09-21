function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeRoster(payload) {
  const source = Array.isArray(payload)
    ? payload
    : payload?.players || payload?.data?.players || payload?.team?.players || [];

  return source.map((entry, index) => {
    const player = entry?.player || entry || {};
    const firstName = text(player.firstName || player.first_name || player.name);
    const lastName = text(player.lastName || player.last_name || player.surname);
    const number = Number.parseInt(entry?.number ?? player.number, 10);
    const avatar = player.avatar || {};
    return {
      id: player.id ?? entry?.player_id ?? `local-${index + 1}`,
      number: Number.isFinite(number) ? number : null,
      firstName,
      lastName,
      shortName: text(player.shortName || player.short_name) || firstName || lastName || `Игрок ${index + 1}`,
      position: text(entry?.position || player.position),
      photoUrl: text(player.photoUrl || player.photo_url || avatar.url || avatar.conversion),
      photoPosition: text(player.photoPosition || player.photo_position) || '50% 16%'
    };
  }).filter(player => player.firstName || player.lastName || player.number !== null);
}

function splitCsvLine(line, delimiter) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"' && quoted) {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      values.push(value.trim());
      value = '';
    } else {
      value += character;
    }
  }
  values.push(value.trim());
  return values;
}

export function parseRosterCsv(csv) {
  const lines = String(csv || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];
  const delimiter = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const aliases = {
    id: ['id', 'player_id', 'playerid'],
    number: ['number', 'номер', '№'],
    firstName: ['first_name', 'firstname', 'имя', 'name'],
    lastName: ['last_name', 'lastname', 'surname', 'фамилия'],
    shortName: ['short_name', 'shortname', 'короткое имя'],
    position: ['position', 'позиция', 'амплуа'],
    photoUrl: ['photo_url', 'photourl', 'photo', 'фото', 'аватар'],
    photoPosition: ['photo_position', 'photoposition']
  };
  const headers = splitCsvLine(lines[0], delimiter).map(header => header.trim().toLowerCase());
  const indexOf = key => headers.findIndex(header => aliases[key].includes(header));
  return normalizeRoster(lines.slice(1).map((line, index) => {
    const columns = splitCsvLine(line, delimiter);
    const get = key => {
      const columnIndex = indexOf(key);
      return columnIndex >= 0 ? columns[columnIndex] : '';
    };
    return {
      id: get('id') || `local-${index + 1}`,
      number: get('number'),
      firstName: get('firstName'),
      lastName: get('lastName'),
      shortName: get('shortName'),
      position: get('position'),
      photoUrl: get('photoUrl'),
      photoPosition: get('photoPosition')
    };
  }));
}
