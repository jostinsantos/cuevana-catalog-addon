/**
 * Addon catálogo Cuevana — TODA la lógica vive en ESTE repo.
 * Adaptado del scraper Dart + enriquecimiento TMDB (misma key del addon TMDB).
 *
 * Base Cuevana: https://wv3.cuevana3.eu
 * TMDB: para tmdbId, géneros extra, temporadas y capítulos
 */

var BASE = 'https://wv3.cuevana3.eu';
var TMDB_BASE = 'https://api.themoviedb.org/3';
var TMDB_IMG = 'https://image.tmdb.org/t/p';
var TMDB_KEY = 'a2d9bbed370d9f678e34006f8750a5a5';
var TMDB_LANG = 'es-MX';

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

// ────────────────────────────────────────────────
// TMDB helpers
// ────────────────────────────────────────────────

async function tmdbGet(path, query) {
  var q = Object.assign(
    { api_key: TMDB_KEY, language: TMDB_LANG },
    query || {}
  );
  var qs = Object.keys(q)
    .map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]);
    })
    .join('&');
  var url = TMDB_BASE + path + '?' + qs;
  var res = await fetch(url);
  if (!res.ok) throw new Error('TMDB HTTP ' + res.status);
  return await res.json();
}

/**
 * Busca en TMDB por título (+ año opcional) y devuelve el mejor match.
 * type: 'movie' | 'tv'
 */
async function tmdbFindByTitle(title, type, year) {
  if (!title) return null;
  var path = type === 'tv' || type === 'series' ? '/search/tv' : '/search/movie';
  var query = { query: title, page: 1 };
  if (year) {
    if (type === 'tv' || type === 'series') query.first_air_date_year = year;
    else query.year = year;
  }
  try {
    var data = await tmdbGet(path, query);
    var results = data.results || [];
    if (!results.length) {
      // reintento sin año
      if (year) {
        data = await tmdbGet(path, { query: title, page: 1 });
        results = data.results || [];
      }
    }
    if (!results.length) return null;
    return results[0];
  } catch (e) {
    return null;
  }
}

/**
 * Detalle TMDB completo (movie o tv) + seasons si es serie
 */
async function tmdbDetail(tmdbId, type) {
  if (!tmdbId) return null;
  var media = type === 'tv' || type === 'series' ? 'tv' : 'movie';
  try {
    var data = await tmdbGet('/' + media + '/' + tmdbId, {});
    return data;
  } catch (e) {
    return null;
  }
}

/**
 * Episodios de una temporada TMDB
 */
async function tmdbSeasonEpisodes(tmdbId, seasonNumber) {
  try {
    var data = await tmdbGet('/tv/' + tmdbId + '/season/' + seasonNumber, {});
    return data;
  } catch (e) {
    return null;
  }
}

// ────────────────────────────────────────────────
// Mapear item Cuevana → formato app
// ────────────────────────────────────────────────

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

  // Géneros siempre como array (aunque vacío) para que la app los vea
  item.genres = genres;

  if (tmdbId) {
    var n = parseInt(tmdbId, 10);
    item.tmdbId = isNaN(n) ? tmdbId : n;
  }
  if (slug) item.slug = slug;

  if (slug) {
    item.url =
      BASE +
      (isTv ? '/ver-serie/' : '/ver-pelicula/') +
      slug;
  }

  return item;
}

/**
 * Fetch genérico de listados Cuevana
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
        mapped.type = 'series';
        mapped.id = 'cuevana:episode:' + sSlug + '-s' + s + 'e' + e;
        mapped.url =
          BASE + '/episodio/' + sSlug + '-temporada-' + s + '-episodio-' + e;
        mapped.season = readInt(s, null);
        mapped.episode = readInt(e, null);
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
// Enriquecer un item con datos TMDB (tmdbId, géneros, seasons…)
// ────────────────────────────────────────────────

async function enrichWithTmdb(item, opts) {
  opts = opts || {};
  var wantSeasons = !!opts.seasons;
  var wantEpisodes = opts.episodes === true; // traer eps de todas las temporadas (puede ser lento)
  var maxSeasonsEps = opts.maxSeasonsEps || 2; // si wantEpisodes, cuántas temporadas

  if (!item) return item;

  var type = item.type === 'series' ? 'tv' : 'movie';
  var tmdbId = item.tmdbId || null;
  var tmdbData = null;

  // 1) Si no hay tmdbId → buscar por título
  if (!tmdbId) {
    var found = await tmdbFindByTitle(item.title, type, item.year);
    if (found && found.id) {
      tmdbId = found.id;
      item.tmdbId = tmdbId;
      if (!item.poster && found.poster_path) {
        item.poster = TMDB_IMG + '/w342' + found.poster_path;
      }
      if (!item.backdrop && found.backdrop_path) {
        item.backdrop = TMDB_IMG + '/w780' + found.backdrop_path;
      }
      if (!item.overview && found.overview) item.overview = found.overview;
      if (!item.year) {
        item.year = yearFromDate(
          found.release_date || found.first_air_date
        );
      }
      if (!item.rating && found.vote_average) {
        item.rating = Number(found.vote_average);
      }
    }
  }

  // 2) Detalle completo si necesitamos géneros / seasons / overview
  var needDetail =
    wantSeasons ||
    !item.genres ||
    !item.genres.length ||
    !item.overview ||
    (type === 'tv' && wantSeasons);

  if (tmdbId && needDetail) {
    tmdbData = await tmdbDetail(tmdbId, type);
  }

  if (tmdbData) {
    if ((!item.genres || !item.genres.length) && Array.isArray(tmdbData.genres)) {
      item.genres = tmdbData.genres.map(function (g) {
        return g.name;
      });
    }
    if (!item.overview && tmdbData.overview) item.overview = tmdbData.overview;
    if (!item.poster && tmdbData.poster_path) {
      item.poster = TMDB_IMG + '/w342' + tmdbData.poster_path;
    }
    if (!item.backdrop && tmdbData.backdrop_path) {
      item.backdrop = TMDB_IMG + '/w780' + tmdbData.backdrop_path;
    }
    if (!item.rating && tmdbData.vote_average) {
      item.rating = Number(tmdbData.vote_average);
    }
    if (!item.year) {
      item.year = yearFromDate(
        tmdbData.release_date || tmdbData.first_air_date
      );
    }
    if (tmdbData.runtime) item.runtime = tmdbData.runtime;
    if (tmdbData.number_of_seasons) {
      item.numberOfSeasons = tmdbData.number_of_seasons;
    }
    if (tmdbData.number_of_episodes) {
      item.numberOfEpisodes = tmdbData.number_of_episodes;
    }

    // Temporadas (series)
    if (wantSeasons && type === 'tv' && Array.isArray(tmdbData.seasons)) {
      item.seasons = tmdbData.seasons
        .filter(function (s) {
          return s.season_number > 0; // omitir especiales (0)
        })
        .map(function (s) {
          return {
            seasonNumber: s.season_number,
            name: s.name || 'Temporada ' + s.season_number,
            episodeCount: s.episode_count || 0,
            overview: s.overview || '',
            airDate: s.air_date || null,
            poster: s.poster_path
              ? TMDB_IMG + '/w342' + s.poster_path
              : null,
          };
        });

      // Opcional: traer episodios de las primeras N temporadas
      if (wantEpisodes && item.seasons.length) {
        var limit = Math.min(item.seasons.length, maxSeasonsEps);
        for (var i = 0; i < limit; i++) {
          var sn = item.seasons[i].seasonNumber;
          var seasonData = await tmdbSeasonEpisodes(tmdbId, sn);
          if (seasonData && Array.isArray(seasonData.episodes)) {
            item.seasons[i].episodes = seasonData.episodes.map(function (ep) {
              return {
                episodeNumber: ep.episode_number,
                seasonNumber: ep.season_number,
                name: ep.name || 'Episodio ' + ep.episode_number,
                overview: ep.overview || '',
                airDate: ep.air_date || null,
                runtime: ep.runtime || null,
                still: ep.still_path
                  ? TMDB_IMG + '/w300' + ep.still_path
                  : null,
                rating: ep.vote_average || null,
              };
            });
          }
        }
      }
    }
  }

  // Asegurar que genres siempre sea array
  if (!item.genres) item.genres = [];

  return item;
}

// ────────────────────────────────────────────────
// API pública del addon
// ────────────────────────────────────────────────

async function getHome(args, config) {
  var rows = [];

  try {
    var movies = await fetchList({ tipo: 'movie', page: 1 });
    rows.push({
      id: 'cuevana-movies',
      title: 'Películas',
      items: movies.items,
    });
  } catch (e) {}

  try {
    var series = await fetchList({ tipo: 'tv', page: 1 });
    rows.push({
      id: 'cuevana-series',
      title: 'Series',
      items: series.items,
    });
  } catch (e) {}

  try {
    var trend = await fetchList({ tipo: 'tendencias', page: 1 });
    rows.push({
      id: 'cuevana-tendencias',
      title: 'Tendencias del día',
      items: trend.items,
    });
  } catch (e) {}

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

async function search(args, config) {
  var q = (args && args.query) || '';
  if (!q || !String(q).trim()) return { items: [] };

  var url = BASE + '/search?q=' + encodeURIComponent(String(q).trim());
  var html = await fetchHtml(url);
  var next = getNextData(html);
  if (!next) return { items: [] };

  var movies =
    (next.props && next.props.pageProps && next.props.pageProps.movies) || [];
  var items = [];

  for (var i = 0; i < movies.length; i++) {
    var m = mapItem(movies[i]);
    if (m) items.push(m);
  }

  // Enrich ligero: solo asegurar tmdbId si falta (sin seasons para no ralentizar búsqueda)
  for (var j = 0; j < items.length; j++) {
    if (!items[j].tmdbId) {
      try {
        items[j] = await enrichWithTmdb(items[j], { seasons: false });
      } catch (e) {}
    }
  }

  return { items: items };
}

async function discover(args, config) {
  var cat = (args && (args.category || args.tipo)) || 'movie';
  var page = (args && args.page) || 1;
  var genero = (args && (args.genero || args.genre || args.genreId)) || null;

  if (genero && /^\d+$/.test(String(genero))) {
    genero = null;
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
 * Meta / detalle
 * - Siempre enriquece con TMDB (tmdbId + géneros)
 * - Si es serie → trae temporadas y episodios de las primeras temporadas
 */
async function getMeta(args, config) {
  var id = (args && args.id) || '';
  var parts = String(id).split(':');

  var media = 'movie';
  var key = id;

  if (parts[0] === 'cuevana' && parts.length >= 3) {
    media =
      parts[1] === 'series' || parts[1] === 'tv' || parts[1] === 'episode'
        ? 'tv'
        : 'movie';
    key = parts.slice(2).join(':');
  }

  var isNumeric = /^\d+$/.test(key);
  var detailUrl;
  var item = null;
  var raw = null;

  if (isNumeric) {
    // id legacy solo con tmdbId → enriquecemos solo con TMDB
    item = {
      id: id,
      title: '',
      type: media === 'tv' ? 'series' : 'movie',
      overview: '',
      poster: null,
      genres: [],
      tmdbId: parseInt(key, 10),
    };
  } else {
    detailUrl =
      BASE + (media === 'tv' ? '/ver-serie/' : '/ver-pelicula/') + key;

    var html = await fetchHtml(detailUrl);
    var next = getNextData(html);
    if (!next) throw new Error('No se encontró __NEXT_DATA__ en detalle');

    var pp = (next.props && next.props.pageProps) || {};
    raw = pp.thisMovie || pp.thisSerie || pp.movie || pp.serie || null;
    if (!raw && pp.movies && pp.movies[0]) raw = pp.movies[0];

    if (raw) {
      item = mapItem(raw, media === 'tv' ? 'tv' : 'movie');
    } else {
      item = {
        id: id,
        title: key,
        type: media === 'tv' ? 'series' : 'movie',
        overview: '',
        poster: null,
        genres: [],
      };
    }
  }

  if (!item) throw new Error('No se pudo construir el item para ' + id);

  // Forzar el id que pidió la app
  item.id = id;

  // Cast desde Cuevana si existe
  if (raw && raw.cast && raw.cast.acting) {
    item.cast = raw.cast.acting
      .slice(0, 15)
      .map(function (c) {
        return c && c.name ? String(c.name) : null;
      })
      .filter(Boolean);
  }

  // ── Enriquecimiento TMDB (tmdbId + géneros + temporadas/capítulos) ──
  var isSeries = item.type === 'series';
  item = await enrichWithTmdb(item, {
    seasons: isSeries,
    episodes: isSeries, // trae episodios de las primeras 2 temporadas
    maxSeasonsEps: 3,
  });

  // Asegurar genres siempre presente
  if (!item.genres) item.genres = [];

  return { item: item };
}

module.exports = {
  getHome: getHome,
  search: search,
  discover: discover,
  getMeta: getMeta,
};
