/**
 * Addon catálogo Cuevana — TODA la lógica vive en ESTE repo.
 * Adaptado del scraper Dart (CuevanaScraper + BuscadorScraper.searchCuevana).
 * La app solo ejecuta estas funciones.
 *
 * Base: https://wv3.cuevana3.eu
 */

var BASE = 'https://wv3.cuevana3.eu';

var GENEROS = [
  'accion',
  'aventura',
  'animacion',
  'ciencia-ficcion',
  'crimen',
  'drama',
  'familia',
  'fantasia',
  'misterio',
  'romance',
  'suspense',
  'terror',
];

var UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ────────────────────────────────────────────────
// Helpers de red y parseo
// ────────────────────────────────────────────────

async function fetchHtml(url) {
  var res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
    },
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' → ' + url);
  return await res.text();
}

function getNextData(html) {
  var m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    return null;
  }
}

function readInt(v, fallback) {
  if (typeof v === 'number') return Math.floor(v);
  if (typeof v === 'string') {
    var n = parseInt(v, 10);
    return isNaN(n) ? fallback : n;
  }
  return fallback;
}

function yearFromDate(d) {
  if (!d) return null;
  var s = String(d);
  if (s.length >= 4) {
    var y = parseInt(s.slice(0, 4), 10);
    return isNaN(y) ? null : y;
  }
  return null;
}

/**
 * Mapea un item de Cuevana al formato que espera la app (igual que TMDB addon).
 */
function mapItem(raw, forceType) {
  if (!raw || typeof raw !== 'object') return null;

  var slugObj = raw.slug || {};
  var slug = (slugObj.name || '').toString();
  var urlSlug = (raw.url && raw.url.slug ? String(raw.url.slug) : '') || '';

  var isTv =
    forceType === 'tv' ||
    forceType === 'series' ||
    urlSlug.indexOf('series/') === 0 ||
    (raw.url && String(raw.url.slug || '').indexOf('series/') === 0);

  // Episodios
  if (forceType === 'episode' || (slugObj.season != null && slugObj.episode != null)) {
    isTv = true;
  }

  var type = isTv ? 'series' : 'movie';
  var tmdbId = raw.TMDbId != null ? String(raw.TMDbId) : null;
  // Preferir slug para poder construir /ver-pelicula|serie/SLUG en getMeta
  var idPart = slug || tmdbId || 'unknown';

  var title =
    (raw.titles && raw.titles.name) ||
    raw.title ||
    raw.name ||
    'Sin título';

  var poster =
    (raw.images && raw.images.poster) ||
    raw.image ||
    raw.poster ||
    null;

  var backdrop =
    (raw.images && raw.images.backdrop) ||
    raw.backdrop ||
    null;

  var rating =
    (raw.rate && raw.rate.average != null
      ? Number(raw.rate.average)
      : raw.rating != null
        ? Number(raw.rating)
        : null) || null;

  var year = yearFromDate(raw.releaseDate);

  var overview = raw.overview || raw.sinopsis || '';

  var genres = [];
  if (Array.isArray(raw.genres)) {
    genres = raw.genres
      .map(function (g) {
        return g && g.name ? String(g.name) : null;
      })
      .filter(Boolean);
  }

  var item = {
    id: 'cuevana:' + type + ':' + idPart,
    title: String(title).trim(),
    type: type,
    poster: poster,
    backdrop: backdrop,
    overview: overview,
    year: year,
    rating: rating,
  };

  if (genres.length) item.genres = genres;
  if (tmdbId) item.tmdbId = parseInt(tmdbId, 10) || tmdbId;
  if (slug) item.slug = slug;

  // URL pública de Cuevana (útil para streams más adelante)
  if (slug) {
    item.url =
      BASE +
      (isTv ? '/ver-serie/' : '/ver-pelicula/') +
      slug;
  }

  return item;
}

/**
 * Fetch genérico de listados Cuevana (películas / series / género / tendencias / episodios)
 */
async function fetchList(opts) {
  opts = opts || {};
  var tipo = opts.tipo || null;
  var genero = opts.genero || null;
  var page = opts.page || 1;

  var path = '';
  var mode = 'movies';

  if (genero && genero.length) {
    if (GENEROS.indexOf(genero) === -1) {
      throw new Error('Género no válido: ' + genero);
    }
    path = '/genero/' + genero;
    mode = 'movies';
  } else {
    switch (String(tipo || '').toLowerCase()) {
      case 'movie':
      case 'pelicula':
      case 'peliculas':
        path = '/peliculas';
        break;
      case 'tv':
      case 'serie':
      case 'series':
        path = '/series';
        break;
      case 'tendencias':
      case 'series-populares':
      case 'tv-tendencias':
        path = '/series/tendencias/dia';
        break;
      case 'episodios':
      case 'capitulos':
        path = '/episodios';
        mode = 'episodes';
        break;
      default:
        path = '/peliculas';
    }
  }

  // Cuevana usa /page/N en la ruta (NO ?page=N)
  var url = BASE + path;
  if (page > 1) url = BASE + path + '/page/' + page;

  var html = await fetchHtml(url);
  var next = getNextData(html);
  if (!next) throw new Error('No se encontró __NEXT_DATA__ en ' + url);

  var pp = (next.props && next.props.pageProps) || {};

  var total = 1;
  var current = page;

  total = readInt(pp.pages, total);
  total = readInt(pp.totalPages, total);
  total = readInt(pp.total_pages, total);

  current = readInt(pp.page, current);
  current = readInt(pp.currentPage, current);
  current = readInt(pp.current_page, current);

  var items = [];

  if (mode === 'episodes' && Array.isArray(pp.episodes)) {
    for (var i = 0; i < pp.episodes.length; i++) {
      var ep = pp.episodes[i];
      if (!ep || typeof ep !== 'object') continue;
      var sSlug = (ep.slug && ep.slug.name) || '';
      var s = (ep.slug && ep.slug.season) || '';
      var e = (ep.slug && ep.slug.episode) || '';
      var mapped = mapItem(
        {
          title: ep.title,
          image: ep.image,
          TMDbId: ep.TMDbId,
          releaseDate: ep.releaseDate,
          slug: { name: sSlug, season: s, episode: e },
        },
        'episode'
      );
      if (mapped) {
        mapped.type = 'series'; // la app espera series o movie
        mapped.id = 'cuevana:episode:' + sSlug + '-s' + s + 'e' + e;
        mapped.url = BASE + '/episodio/' + sSlug + '-temporada-' + s + '-episodio-' + e;
        items.push(mapped);
      }
    }
  } else if (Array.isArray(pp.movies)) {
    var force = path.indexOf('/series') === 0 ? 'tv' : null;
    for (var j = 0; j < pp.movies.length; j++) {
      var m = mapItem(pp.movies[j], force);
      if (m) items.push(m);
    }
  }

  return {
    items: items,
    currentPage: current,
    totalPages: total,
    hasNext: items.length > 0 && current < total,
    url: url,
  };
}

// ────────────────────────────────────────────────
// API pública del addon (mismo contrato que TMDB)
// ────────────────────────────────────────────────

/**
 * Home: varias filas (películas, series, tendencias, episodios)
 */
async function getHome(args, config) {
  var rows = [];

  // 1. Películas recientes
  try {
    var movies = await fetchList({ tipo: 'movie', page: 1 });
    rows.push({
      id: 'cuevana-movies',
      title: 'Películas',
      items: movies.items,
    });
  } catch (e) {
    // silenciar fila rota
  }

  // 2. Series
  try {
    var series = await fetchList({ tipo: 'tv', page: 1 });
    rows.push({
      id: 'cuevana-series',
      title: 'Series',
      items: series.items,
    });
  } catch (e) {}

  // 3. Tendencias del día (series)
  try {
    var trend = await fetchList({ tipo: 'tendencias', page: 1 });
    rows.push({
      id: 'cuevana-tendencias',
      title: 'Tendencias del día',
      items: trend.items,
    });
  } catch (e) {}

  // 4. Últimos episodios
  try {
    var eps = await fetchList({ tipo: 'episodios', page: 1 });
    if (eps.items.length) {
      rows.push({
        id: 'cuevana-episodios',
        title: 'Últimos episodios',
        items: eps.items,
      });
    }
  } catch (e) {}

  return { rows: rows };
}

/**
 * Búsqueda
 */
async function search(args, config) {
  var q = (args && args.query) || '';
  if (!q || !String(q).trim()) return { items: [] };

  var url = BASE + '/search?q=' + encodeURIComponent(String(q).trim());
  var html = await fetchHtml(url);
  var next = getNextData(html);
  if (!next) return { items: [] };

  var movies = (next.props && next.props.pageProps && next.props.pageProps.movies) || [];
  var items = [];

  for (var i = 0; i < movies.length; i++) {
    var m = mapItem(movies[i]);
    if (m) items.push(m);
  }

  return { items: items };
}

/**
 * Discover / listados paginados
 * args.category: movie | tv | anime | dorama | tendencias | episodios
 * args.genreId / args.genero: slug de género Cuevana (accion, terror…)
 * args.page: número de página
 */
async function discover(args, config) {
  var cat = (args && (args.category || args.tipo)) || 'movie';
  var page = (args && args.page) || 1;
  var genero = (args && (args.genero || args.genre || args.genreId)) || null;

  // Normalizar genreId numérico no aplica aquí (Cuevana usa slugs)
  if (genero && /^\d+$/.test(String(genero))) {
    genero = null; // ignorar ids numéricos de TMDB
  }

  var result = await fetchList({
    tipo: genero ? null : cat,
    genero: genero,
    page: page,
  });

  return {
    items: result.items,
    page: result.currentPage,
    totalPages: result.totalPages,
    hasNext: result.hasNext,
  };
}

/**
 * Meta / detalle de un título
 * id esperado: cuevana:movie:SLUG_O_TMDB  |  cuevana:series:SLUG_O_TMDB
 */
async function getMeta(args, config) {
  var id = (args && args.id) || '';
  var parts = String(id).split(':');

  var media = 'movie';
  var key = id;

  if (parts[0] === 'cuevana' && parts.length >= 3) {
    media = parts[1] === 'series' || parts[1] === 'tv' || parts[1] === 'episode' ? 'tv' : 'movie';
    key = parts.slice(2).join(':'); // por si el slug tiene :
  }

  // Si es un número → probablemente TMDbId (legacy); intentamos buscar en el sitio
  // Si es slug → construimos URL directa
  var isNumeric = /^\d+$/.test(key);
  var detailUrl;

  if (isNumeric) {
    // El buscador de Cuevana no indexa bien por TMDbId puro.
    // Devolvemos un item mínimo; la app debería preferir ids con slug.
    return {
      item: {
        id: id,
        title: 'TMDb ' + key,
        type: media === 'tv' ? 'series' : 'movie',
        overview: '',
        poster: null,
        tmdbId: parseInt(key, 10),
      },
    };
  } else {
    detailUrl =
      BASE + (media === 'tv' ? '/ver-serie/' : '/ver-pelicula/') + key;
  }

  if (!detailUrl) throw new Error('No se pudo construir URL de detalle para ' + id);

  var html = await fetchHtml(detailUrl);
  var next = getNextData(html);
  if (!next) throw new Error('No se encontró __NEXT_DATA__ en detalle');

  var pp = (next.props && next.props.pageProps) || {};
  var raw = pp.thisMovie || pp.thisSerie || pp.movie || pp.serie || null;

  // Fallback: a veces el objeto principal está en otro sitio
  if (!raw && pp.movies && pp.movies[0]) raw = pp.movies[0];

  if (!raw) {
    // Devolver al menos lo que tengamos del listado
    return {
      item: {
        id: id,
        title: key,
        type: media === 'tv' ? 'series' : 'movie',
        overview: '',
        poster: null,
      },
    };
  }

  var item = mapItem(raw, media === 'tv' ? 'tv' : 'movie');
  if (!item) throw new Error('No se pudo mapear el item de detalle');

  // Forzar el id original que pidió la app
  item.id = id;
  item.overview = raw.overview || item.overview || '';

  if (Array.isArray(raw.genres)) {
    item.genres = raw.genres
      .map(function (g) {
        return g && g.name ? String(g.name) : null;
      })
      .filter(Boolean);
  }

  if (raw.runtime) item.runtime = Number(raw.runtime) || null;
  if (raw.cast && raw.cast.acting) {
    item.cast = raw.cast.acting
      .slice(0, 12)
      .map(function (c) {
        return c && c.name ? String(c.name) : null;
      })
      .filter(Boolean);
  }

  return { item: item };
}

module.exports = {
  getHome: getHome,
  search: search,
  discover: discover,
  getMeta: getMeta,
};
