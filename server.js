const express = require('express');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const OMDB_API_KEY = process.env.OMDB_API_KEY;
const TMDB_API_KEY = process.env.TMDB_API_KEY;

const TMDB_IMAGE_BASE_URL_W92 = 'https://image.tmdb.org/t/p/w92';
const TMDB_IMAGE_BASE_URL_W500 = 'https://image.tmdb.org/t/p/w500';

// ✅ Force redirect to canonical domain
app.use((req, res, next) => {
  const host = req.headers.host;
  if (host !== 'www.fastfilmscore.com') {
    return res.redirect(301, `https://www.fastfilmscore.com${req.originalUrl}`);
  }
  next();
});

// Middleware

app.use(express.static('public'));

const getMovieProperty = (omdbValue, tmdbValue, fallback = 'N/A') => {
  if (omdbValue && omdbValue !== 'N/A') return omdbValue;
  if (tmdbValue && tmdbValue !== 'N/A') return tmdbValue;
  return fallback;
};

app.get('/api/movie', async (req, res) => {
  const { title, tmdbId } = req.query;

  try {
    if (!tmdbId) {
      const searchResponse = await axios.get(`https://api.themoviedb.org/3/search/movie`, {
        params: { api_key: TMDB_API_KEY, query: title }
      });

      const results = searchResponse.data.results;

      if (results.length === 0) {
        return res.status(404).json({ error: 'No matches found.' });
      } else if (results.length === 1) {
        return res.redirect(`/api/movie?tmdbId=${results[0].id}`);
      } else {
        return res.json({ multiple: true, results });
      }
    } else {
      const tmdbDetailsPromise = axios.get(`https://api.themoviedb.org/3/movie/${tmdbId}`, {
        params: { api_key: TMDB_API_KEY }
      });
      const omdbResponsePromise = axios.get(`https://www.omdbapi.com/`, {
        params: { apikey: OMDB_API_KEY, i: tmdbId }
      });
      const providersResPromise = axios.get(`https://api.themoviedb.org/3/movie/${tmdbId}/watch/providers`, {
        params: { api_key: TMDB_API_KEY }
      });

      const [tmdbDetails, omdbResponse, providersRes] = await Promise.all([
        tmdbDetailsPromise,
        omdbResponsePromise.catch(error => {
          console.warn("OMDB API call failed:", error.message);
          return { data: {} };
        }),
        providersResPromise
      ]);

      const movie = tmdbDetails.data;
      const omdb = omdbResponse.data;

      if (!omdb.Title && movie.imdb_id) {
        try {
          const omdbByIdResponse = await axios.get(`https://www.omdbapi.com/`, {
            params: { apikey: OMDB_API_KEY, i: movie.imdb_id }
          });
          Object.assign(omdb, omdbByIdResponse.data);
        } catch (error) {
          console.warn("OMDB API retry failed:", error.message);
        }
      }

      // Parse scores safely
      const rtRaw = omdb.Ratings?.find(r => r.Source === 'Rotten Tomatoes')?.Value;
      const scores = {
        IMDb: omdb.imdbRating && omdb.imdbRating !== 'N/A' ? parseFloat(omdb.imdbRating) * 10 : null,
        'Rotten Tomatoes': rtRaw ? parseInt(rtRaw.replace('%', '')) : null,
        Metacritic: omdb.Metascore !== 'N/A' ? parseInt(omdb.Metascore) : null,
        TMDb: movie.vote_average ? Math.round(movie.vote_average * 10) : null
      };

      // Calculate average of available scores
      const scoreValues = Object.values(scores).filter(s => s !== null);
      const average = scoreValues.length
        ? Math.round(scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length)
        : 'N/A';

      const ukFlatrate = providersRes.data.results?.GB?.flatrate || [];
      const streaming = ukFlatrate
        .filter(p => p.logo_path)
        .map(p => ({
          name: p.provider_name,
          logo: `${TMDB_IMAGE_BASE_URL_W92}${p.logo_path}`
        }));

      const movieInfo = {
        title: getMovieProperty(omdb.Title, movie.title || movie.original_title),
        year: getMovieProperty(omdb.Year, movie.release_date?.split('-')[0]),
        rated: getMovieProperty(omdb.Rated, null),
        released: getMovieProperty(omdb.Released, null),
        genre: getMovieProperty(omdb.Genre, movie.genres?.map(g => g.name).join(', ')),
        director: getMovieProperty(omdb.Director, null),
        writer: getMovieProperty(omdb.Writer, null),
        actors: getMovieProperty(omdb.Actors, null),
        language: getMovieProperty(omdb.Language, movie.spoken_languages?.map(l => l.english_name).join(', ')),
        country: getMovieProperty(omdb.Country, null),
        awards: getMovieProperty(omdb.Awards, null),
        production: getMovieProperty(omdb.Production, movie.production_companies?.map(pc => pc.name).join(', ')),
        boxOffice: getMovieProperty(omdb.BoxOffice, null),
        dvd: getMovieProperty(omdb.DVD, null),
        type: getMovieProperty(omdb.Type, movie.media_type || 'movie'),
        plot: getMovieProperty(omdb.Plot, movie.overview),
        website: omdb.Website && omdb.Website !== 'N/A'
          ? omdb.Website
          : movie.homepage || 'N/A',
        poster: getMovieProperty(omdb.Poster, movie.poster_path ? `${TMDB_IMAGE_BASE_URL_W500}${movie.poster_path}` : null),
        imdbVotes: omdb.imdbVotes
      };

      return res.json({ movieInfo, scores, average, streaming });
    }
  } catch (err) {
    console.error("API Error:", err);
    if (axios.isAxiosError(err) && err.response) {
      if (err.response.status === 401) {
        return res.status(401).json({ error: 'API Key unauthorized or invalid.' });
      }
      if (err.response.status === 404) {
        return res.status(404).json({ error: 'Requested movie details not found.' });
      }
      return res.status(err.response.status).json({ error: err.response.data?.status_message || 'External API communication error.' });
    } else if (axios.isAxiosError(err) && err.request) {
      return res.status(503).json({ error: 'Service unavailable: External API not responding.' });
    } else {
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }
});
app.get('/sitemap.xml', (req, res) => {
  res.sendFile(path.join(__dirname, 'sitemap.xml'));
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/about.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'about.html'));
});
app.get('/faq.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'faq.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
