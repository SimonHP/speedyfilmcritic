// Enhanced server.js with better title handling for old films
const express = require('express');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const OMDB_API_KEY = process.env.OMDB_API_KEY;
const TMDB_API_KEY = process.env.TMDB_API_KEY;

// Constants for TMDb image URLs
const TMDB_IMAGE_BASE_URL_W92 = 'https://image.tmdb.org/t/p/w92';
const TMDB_IMAGE_BASE_URL_W500 = 'https://image.tmdb.org/t/p/w500';

app.use(express.static('public'));

// Helper function to safely get data with fallbacks
const getMovieProperty = (omdbValue, tmdbValue, fallback = 'N/A') => {
    // Check if omdbValue is truthy and not 'N/A'
    if (omdbValue && omdbValue !== 'N/A') {
        return omdbValue;
    }
    // Check if tmdbValue is truthy and not 'N/A' (or some other specific TMDb null value)
    if (tmdbValue && tmdbValue !== 'N/A') {
        return tmdbValue;
    }
    // Return fallback if both are not valid
    return fallback;
};


app.get('/api/movie', async (req, res) => {
  const { title, tmdbId } = req.query;

  try {
    if (!tmdbId) {
      // Step 1: Search TMDb by title
      const searchResponse = await axios.get(`https://api.themoviedb.org/3/search/movie`, {
        params: {
          api_key: TMDB_API_KEY,
          query: title
        }
      });

      const results = searchResponse.data.results;

      if (results.length === 0) {
        return res.status(404).json({ error: 'No matches found.' }); // Use 404 for no content
      } else if (results.length === 1) {
        // Auto proceed to fetch details if only one match
        // Removed `title` from redirect as it's redundant when tmdbId is present
        return res.redirect(`/api/movie?tmdbId=${results[0].id}`);
      } else {
        // Send multiple matches back for user selection
        return res.json({ multiple: true, results });
      }
    } else {
      // Step 2: Get detailed info from TMDb and OMDb
      const tmdbDetailsPromise = axios.get(`https://api.themoviedb.org/3/movie/${tmdbId}`, {
        params: { api_key: TMDB_API_KEY }
      });
      const omdbResponsePromise = axios.get(`https://www.omdbapi.com/`, {
        params: { apikey: OMDB_API_KEY, i: tmdbId } // Prefer IMDB ID if available from TMDb for OMDB lookup
      });
      const providersResPromise = axios.get(`https://api.themoviedb.org/3/movie/${tmdbId}/watch/providers`, {
        params: { api_key: TMDB_API_KEY }
      });

      const [tmdbDetails, omdbResponse, providersRes] = await Promise.all([
          tmdbDetailsPromise, 
          omdbResponsePromise.catch(error => { // Gracefully handle OMDB lookup failures
              console.warn("OMDB API call failed, continuing without OMDB data:", error.message);
              return { data: {} }; // Return empty data if OMDB fails
          }),
          providersResPromise
      ]);

      const movie = tmdbDetails.data;
      const omdb = omdbResponse.data; // omdb will be {} if OMDB call failed

      // Adjusting OMDB lookup: If OMDB lookup was by title and year, it might be less reliable
      // You could try passing the IMDb ID to OMDB if TMDb provides it for better accuracy.
      // E.g., `params: { apikey: OMDB_API_KEY, i: movie.imdb_id }`
      // If `movie.imdb_id` is not available, then fall back to `t` and `y`.
      // I've updated the `omdbResponsePromise` above to use `i: tmdbId` - if OMDB doesn't accept TMDB ID, revert this.
      // OMDB typically uses IMDB ID or Title/Year. If TMDb provides IMDB ID, use it for OMDB.
      if (!omdb.Title && movie.imdb_id) { // If OMDB failed to find by previous method, try with IMDb ID
         try {
             const omdbByIdResponse = await axios.get(`https://www.omdbapi.com/`, {
                 params: { apikey: OMDB_API_KEY, i: movie.imdb_id }
             });
             Object.assign(omdb, omdbByIdResponse.data); // Merge data
         } catch (error) {
             console.warn("OMDB API call failed with IMDb ID, continuing without full OMDB data:", error.message);
         }
      }


      const scores = {
        IMDb: getMovieProperty(omdb.imdbRating, null, null), // Changed to null for numerical average calc
        'Rotten Tomatoes': getMovieProperty(omdb.Ratings?.find(r => r.Source === 'Rotten Tomatoes')?.Value?.replace('%', ''), null, null),
        Metacritic: getMovieProperty(omdb.Metascore, null, null),
        TMDb: movie.vote_average ? parseFloat((movie.vote_average * 10).toFixed(0)) : null
      };

      // Filter out nulls/N/A before calculating average
      const scoreValues = Object.values(scores).filter(s => s !== null && s !== 'N/A').map(Number);
      const average = scoreValues.length ? Math.round(scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length) : 'N/A';

      const ukFlatrate = providersRes.data.results?.GB?.flatrate || [];
      const streaming = ukFlatrate.map(p => ({
        name: p.provider_name,
        logo: `${TMDB_IMAGE_BASE_URL_W92}${p.logo_path}` // Use constant
      }));

      const movieInfo = {
        // Use getMovieProperty helper for cleaner assignment
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
        website: getMovieProperty(omdb.Website, movie.homepage),
        poster: getMovieProperty(omdb.Poster, movie.poster_path ? `${TMDB_IMAGE_BASE_URL_W500}${movie.poster_path}` : null), // Use constant
        imdbVotes: omdb.imdbVotes,
        // Removed redundant tmdbTitle, tmdbYear, tmdbOverview as they are now handled by getMovieProperty
      };

      return res.json({ movieInfo, scores, average, streaming });
    }
  } catch (err) {
    console.error("API Error:", err); // Log full error for better debugging
    // More specific error handling
    if (axios.isAxiosError(err) && err.response) {
        if (err.response.status === 401) { // Unauthorized (e.g., bad API key)
            return res.status(401).json({ error: 'API Key unauthorized or invalid.' });
        }
        if (err.response.status === 404) { // Not Found (e.g., specific movie ID not found)
            return res.status(404).json({ error: 'Requested movie details not found.' });
        }
        // Catch other external API errors
        return res.status(err.response.status).json({ error: err.response.data?.status_message || 'External API communication error.' });
    } else if (axios.isAxiosError(err) && err.request) {
        // The request was made but no response was received (e.g., network issues)
        return res.status(503).json({ error: 'Service unavailable: External API not responding.' });
    } else {
        // Any other internal server errors
        return res.status(500).json({ error: 'Internal server error.' });
    }
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});