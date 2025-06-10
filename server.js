require('dotenv').config(); // Load environment variables from .env

const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// Use environment variables instead of hardcoded keys
const OMDB_API_KEY = process.env.OMDB_API_KEY;
const TMDB_API_KEY = process.env.TMDB_API_KEY;

app.use(express.static('.'));

app.get('/api/movie', async (req, res) => {
  const title = req.query.title;
  if (!title) return res.json({ error: 'Title required' });

  try {
    // Fetch OMDb data
    const omdbResponse = await axios.get(`http://www.omdbapi.com/?t=${encodeURIComponent(title)}&apikey=${OMDB_API_KEY}`);
    const omdb = omdbResponse.data;

    if (omdb.Response === 'False') {
      return res.json({ error: 'Movie not found' });
    }

    const movieInfo = {
      title: omdb.Title,
      year: omdb.Year,
      genre: omdb.Genre,
      director: omdb.Director,
      writer: omdb.Writer,
      actors: omdb.Actors,
      language: omdb.Language,
      country: omdb.Country,
      awards: omdb.Awards,
      production: omdb.Production,
      boxOffice: omdb.BoxOffice,
      dvd: omdb.DVD,
      type: omdb.Type,
      rated: omdb.Rated,
      released: omdb.Released,
      plot: omdb.Plot,
      website: omdb.Website,
      imdbRating: omdb.imdbRating,
      imdbVotes: omdb.imdbVotes,
      poster: omdb.Poster
    };

    const ratings = omdb.Ratings || [];
    const scores = {};
    let total = 0;
    let count = 0;

    ratings.forEach(rating => {
      const source = rating.Source;
      let score;

      if (source === 'Internet Movie Database') {
        score = parseFloat(rating.Value.split('/')[0]) * 10;
        scores.IMDb = score;
      } else if (source === 'Rotten Tomatoes') {
        score = parseInt(rating.Value.replace('%', ''));
        scores['Rotten Tomatoes'] = score;
      } else if (source === 'Metacritic') {
        score = parseInt(rating.Value.split('/')[0]);
        scores.Metacritic = score;
      }

      if (!isNaN(score)) {
        total += score;
        count++;
      }
    });

    let tmdbRating = null;
    let streaming = [];

    const tmdbSearch = await axios.get(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}`);
    const tmdbResults = tmdbSearch.data.results;

    if (tmdbResults && tmdbResults.length > 0) {
      const tmdbId = tmdbResults[0].id;

      const tmdbDetails = await axios.get(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`);
      const tmdb = tmdbDetails.data;
      if (tmdb.vote_average) {
        const score = Math.round(tmdb.vote_average * 10);
        scores.TMDb = score;
        total += score;
        count++;
        tmdbRating = score;
      }

      const providerResponse = await axios.get(`https://api.themoviedb.org/3/movie/${tmdbId}/watch/providers?api_key=${TMDB_API_KEY}`);
      const providers = providerResponse.data.results?.GB?.flatrate || [];

      streaming = providers.map(p => ({
        name: p.provider_name,
        logo: `https://image.tmdb.org/t/p/w92${p.logo_path}`
      }));
    }

    const average = count > 0 ? Math.round(total / count) : null;

    res.json({ movieInfo, scores, average, streaming });

  } catch (err) {
    console.error(err.message);
    res.json({ error: 'Failed to fetch movie data' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});