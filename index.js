/**
 * Addon catálogo Cuevana v1.2
 * - Lista / busca en Cuevana (wv3.cuevana3.eu)
 * - IDs en formato tmdb:movie:ID / tmdb:series:ID (igual que el addon TMDB)
 *   → así la app carga temporadas/capítulos con su TmdbService
 * - extra.tmdbId, extra.seasons, extra.cuevanaSlug, etc.
 */

var BASE = 'https://wv3.cuevana3.eu';
var TMDB_BASE = 'https://api.themoviedb.org/3';
var TMDB_IMG = 'https://image.tmdb.org/t/p';
var TMDB_KEY = 'a2d9bbed370d9f678e34006f8750a5a5';
var TMDB_LANG = 'es-MX';

var GENEROS = [
  'accion', 'aventura', 'animacion', 'ciencia-ficcion', 'crimen',
  'drama', 'familia', 'fantasia', 'misterio', 'romance', 'suspense', 'terror',
];

var UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
  var res = await fetch(TMDB_BASE + path + '?' + qs);
  if (!res.ok) throw new Error('TMDB HTTP ' + res.status);
  return await res.json();
}

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
    if (!results.length && year) {
      data = await tmdbGet(path, { query: title, page: 1 });
      results = data.results || [];
    }
    return results.length ? results[0] : null;
  } catch (e) {
    return null;
  }
}

async function tmdbDetail(tmdbId, type) {
  if (!tmdbId) return null;
  var media = type === 'tv' || type === 'series' ? 'tv' : 'movie';
  try {
    return await tmdbGet('/' + media + '/' + tmdbId, {
      append_to_response: 'external_ids',
    });
  } catch (e) {
    return null;
  }
}

function mapItem(raw, forceType) {
  if (!raw || typeof raw !== 'object') return null;

  var slugObj = raw.slug || {};
  var slug = (slugObj.name || '').toString();
  var urlSlug = (raw.url && raw.url.slug ? String(raw.url.slug) : '') || '';

  var isTv =
    forceType === 'tv' ||
    forceType === 'series' ||
    urlSlug.indexOf('series/') === 0;

  if (forceType === 'episode' || (slugObj.season != null && slugObj.episode != null)) {
    isTv = true;
  }

  var type = isTv ? 'series' : 'movie';
  var mediaType = isTv ? 'tv' : 'movie';

  var tmdbRaw = raw.TMDbId != null ? String(raw.TMDbId) : null;
  var tmdbId = tmdbRaw ? parseInt(tmdbRaw, 10) : null;
  if (tmdbId && isNaN(tmdbId)) tmdbId = null;

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

  // ID crítico: la app solo carga temporadas si el id es tmdb:series:N / tmdb:movie:N
  var id;
  if (tmdbId) {
    id = 'tmdb:' + type + ':' + tmdbId;
  } else if (slug) {
    id = 'cuevana:' + type + ':' + slug;
  } else {
    id = 'cuevana:' + type + ':unknown';
  }

  var cuevanaUrl = null;
  if (slug) {
    cuevanaUrl =
      BASE + (isTv ? '/ver-serie/' : '/ver-pelicula/') + slug;
  }

  var extra = {
    source: 'cuevana',
    mediaType: mediaType,
  };
  if (tmdbId) extra.tmdbId = tmdbId;
  if (slug) extra.cuevanaSlug = slug;
  if (cuevanaUrl) extra.cuevanaUrl = cuevanaUrl;

  var item = {
    id: id,
    title: String(title).trim(),
    type: type,
    poster: poster,
    backdrop: backdrop,
    overview: overview,
    year: year != null ? String(year) : null,
    rating: rating,
    genres: genres,
    extra: extra,
  };

  if (tmdbId) item.tmdbId = tmdbId;
  if (slug) item.slug = slug;
  if (cuevanaUrl) item.url = cuevanaUrl;

  return item;
}

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
          url: { slug: 'series/' + sSlug },
        },
        'tv'
      );
      if (mapped) {
        mapped.extra = mapped.extra || {};
        mapped.extra.season = readInt(s, null);
        mapped.extra.episode = readInt(e, null);
        mapped.extra.cuevanaUrl =
          BASE + '/episodio/' + sSlug + '-temporada-' + s + '-episodio-' + e;
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

async function enrichWithTmdb(item, opts) {
  opts = opts || {};
  var wantSeasons = !!opts.seasons;
  if (!item) return item;

  var type = item.type === 'series' ? 'tv' : 'movie';
  var tmdbId = (item.extra && item.extra.tmdbId) || item.tmdbId || null;
  var tmdbData = null;

  if (!tmdbId) {
    var found = await tmdbFindByTitle(
      item.title,
      type,
      item.year ? parseInt(item.year, 10) : null
    );
    if (found && found.id) {
      tmdbId = found.id;
      if (!item.poster && found.poster_path) {
        item.poster = TMDB_IMG + '/w342' + found.poster_path;
      }
      if (!item.backdrop && found.backdrop_path) {
        item.backdrop = TMDB_IMG + '/w780' + found.backdrop_path;
      }
      if (!item.overview && found.overview) item.overview = found.overview;
      if (!item.year) {
        var y = yearFromDate(found.release_date || found.first_air_date);
        if (y) item.year = String(y);
      }
      if (!item.rating && found.vote_average) {
        item.rating = Number(found.vote_average);
      }
    }
  }

  if (tmdbId) {
    item.tmdbId = tmdbId;
    item.extra = item.extra || {};
    item.extra.tmdbId = tmdbId;
    item.extra.mediaType = type;
    item.id = 'tmdb:' + (type === 'tv' ? 'series' : 'movie') + ':' + tmdbId;
  }

  var needDetail =
    wantSeasons ||
    !item.genres ||
    !item.genres.length ||
    !item.overview;

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
      var y2 = yearFromDate(tmdbData.release_date || tmdbData.first_air_date);
      if (y2) item.year = String(y2);
    }
    if (!item.title && (tmdbData.title || tmdbData.name)) {
      item.title = tmdbData.title || tmdbData.name;
    }

    item.extra = item.extra || {};
    if (tmdbData.runtime) item.extra.runtime = tmdbData.runtime;
    if (tmdbData.number_of_seasons != null) {
      item.extra.numberOfSeasons = tmdbData.number_of_seasons;
    }
    if (tmdbData.number_of_episodes != null) {
      item.extra.numberOfEpisodes = tmdbData.number_of_episodes;
    }
    if (tmdbData.external_ids && tmdbData.external_ids.imdb_id) {
      item.extra.imdbId = tmdbData.external_ids.imdb_id;
    }

    if (wantSeasons && type === 'tv' && Array.isArray(tmdbData.seasons)) {
      item.extra.seasons = tmdbData.seasons
        .filter(function (s) {
          return s.season_number > 0;
        })
        .map(function (s) {
          return {
            seasonNumber: s.season_number,
            name: s.name || 'Temporada ' + s.season_number,
            episodeCount: s.episode_count || 0,
            overview: s.overview || '',
            airDate: s.air_date || null,
            poster: s.poster_path
              ? TMDB_IMG + '/w300' + s.poster_path
              : null,
          };
        });
    }
  }

  if (!item.genres) item.genres = [];
  return item;
}

async function getHome(args, config) {
  var rows = [];

  try {
    var movies = await fetchList({ tipo: 'movie', page: 1 });
    rows.push({
      id: 'cuevana-movies',
      title: 'Películas (Cuevana)',
      items: movies.items,
    });
  } catch (e) {}

  try {
    var series = await fetchList({ tipo: 'tv', page: 1 });
    rows.push({
      id: 'cuevana-series',
      title: 'Series (Cuevana)',
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

  var missing = 0;
  for (var j = 0; j < items.length && missing < 5; j++) {
    if (!items[j].extra || !items[j].extra.tmdbId) {
      try {
        items[j] = await enrichWithTmdb(items[j], { seasons: false });
        missing++;
      } catch (e) {}
    }
  }

  return { items: items };
}

async function discover(args, config) {
  var cat = (args && (args.category || args.tipo)) || 'movie';
  var page = (args && args.page) || 1;
  var genero = (args && (args.genero || args.genre || args.genreId)) || null;

  if (genero && /^\d+$/.test(String(genero))) genero = null;

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

async function getMeta(args, config) {
  var id = (args && args.id) || '';
  var parts = String(id).split(':');

  var media = 'movie';
  var key = id;
  var knownTmdbId = null;

  if (parts[0] === 'tmdb' && parts.length >= 3) {
    media = parts[1] === 'series' || parts[1] === 'tv' ? 'tv' : 'movie';
    knownTmdbId = parseInt(parts[2], 10);
    key = parts[2];
  } else if (parts[0] === 'cuevana' && parts.length >= 3) {
    media = parts[1] === 'series' || parts[1] === 'tv' || parts[1] === 'episode'
      ? 'tv'
      : 'movie';
    key = parts.slice(2).join(':');
  }

  var item = null;
  var raw = null;

  if (knownTmdbId && !isNaN(knownTmdbId)) {
    item = {
      id: 'tmdb:' + (media === 'tv' ? 'series' : 'movie') + ':' + knownTmdbId,
      title: '',
      type: media === 'tv' ? 'series' : 'movie',
      overview: '',
      poster: null,
      genres: [],
      extra: {
        source: 'cuevana',
        tmdbId: knownTmdbId,
        mediaType: media,
      },
      tmdbId: knownTmdbId,
    };
  } else if (!/^\d+$/.test(key)) {
    var detailUrl =
      BASE + (media === 'tv' ? '/ver-serie/' : '/ver-pelicula/') + key;
    try {
      var html = await fetchHtml(detailUrl);
      var next = getNextData(html);
      if (next) {
        var pp = (next.props && next.props.pageProps) || {};
        raw = pp.thisMovie || pp.thisSerie || pp.movie || pp.serie || null;
        if (!raw && pp.movies && pp.movies[0]) raw = pp.movies[0];
      }
    } catch (e) {}

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
        extra: { source: 'cuevana', mediaType: media, cuevanaSlug: key },
      };
    }
  } else {
    item = {
      id: id,
      title: '',
      type: media === 'tv' ? 'series' : 'movie',
      overview: '',
      poster: null,
      genres: [],
      extra: {
        source: 'cuevana',
        tmdbId: parseInt(key, 10),
        mediaType: media,
      },
      tmdbId: parseInt(key, 10),
    };
  }

  if (!item) throw new Error('No se pudo construir item para ' + id);

  if (raw && raw.cast && raw.cast.acting) {
    item.extra = item.extra || {};
    item.extra.cast = raw.cast.acting
      .slice(0, 15)
      .map(function (c) {
        return c && c.name ? String(c.name) : null;
      })
      .filter(Boolean);
  }

  item = await enrichWithTmdb(item, {
    seasons: item.type === 'series',
  });

  if (!item.genres) item.genres = [];
  return { item: item };
}

module.exports = {
  getHome: getHome,
  search: search,
  discover: discover,
  getMeta: getMeta,
};
