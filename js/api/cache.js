/**
 * LocalStorage/SessionStorage Caching Layer
 * Provides TTL-based caching for API data
 */

const CACHE_PREFIX = 'npl_';
const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

/**
 * Cache class for managing cached data
 */
class Cache {
    constructor(storage = sessionStorage) {
        this.storage = storage;
    }

    /**
     * Get cached data
     * @param {string} key - Cache key
     * @returns {any|null} Cached data or null if expired/missing
     */
    get(key) {
        const cacheKey = CACHE_PREFIX + key;
        const cached = this.storage.getItem(cacheKey);

        if (!cached) {
            return null;
        }

        try {
            const { data, expiry } = JSON.parse(cached);

            // Check if expired
            if (expiry && Date.now() > expiry) {
                this.storage.removeItem(cacheKey);
                return null;
            }

            return data;
        } catch (e) {
            // Invalid cache data
            this.storage.removeItem(cacheKey);
            return null;
        }
    }

    /**
     * Set cached data
     * @param {string} key - Cache key
     * @param {any} data - Data to cache
     * @param {number} ttl - Time to live in milliseconds
     */
    set(key, data, ttl = DEFAULT_TTL) {
        const cacheKey = CACHE_PREFIX + key;
        const cacheData = {
            data,
            expiry: ttl > 0 ? Date.now() + ttl : null,
            timestamp: Date.now(),
        };

        try {
            this.storage.setItem(cacheKey, JSON.stringify(cacheData));
        } catch (e) {
            // Storage full, clear old entries
            this.clearOldest();
            try {
                this.storage.setItem(cacheKey, JSON.stringify(cacheData));
            } catch (e2) {
                console.warn('Cache storage full, unable to cache:', key);
            }
        }
    }

    /**
     * Remove cached data
     * @param {string} key - Cache key
     */
    remove(key) {
        const cacheKey = CACHE_PREFIX + key;
        this.storage.removeItem(cacheKey);
    }

    /**
     * Clear all NPL cache entries
     */
    clear() {
        const keys = [];
        for (let i = 0; i < this.storage.length; i++) {
            const key = this.storage.key(i);
            if (key && key.startsWith(CACHE_PREFIX)) {
                keys.push(key);
            }
        }
        keys.forEach(key => this.storage.removeItem(key));
    }

    /**
     * Clear oldest cache entries
     */
    clearOldest() {
        const entries = [];

        for (let i = 0; i < this.storage.length; i++) {
            const key = this.storage.key(i);
            if (key && key.startsWith(CACHE_PREFIX)) {
                try {
                    const cached = JSON.parse(this.storage.getItem(key));
                    entries.push({ key, timestamp: cached.timestamp || 0 });
                } catch (e) {
                    // Remove invalid entries
                    this.storage.removeItem(key);
                }
            }
        }

        // Sort by timestamp (oldest first) and remove oldest half
        entries.sort((a, b) => a.timestamp - b.timestamp);
        const toRemove = Math.ceil(entries.length / 2);

        for (let i = 0; i < toRemove; i++) {
            this.storage.removeItem(entries[i].key);
        }
    }

    /**
     * Check if cache key exists and is valid
     * @param {string} key - Cache key
     * @returns {boolean} Whether cache is valid
     */
    has(key) {
        return this.get(key) !== null;
    }

    /**
     * Get cache age in milliseconds
     * @param {string} key - Cache key
     * @returns {number|null} Age in ms or null if not cached
     */
    getAge(key) {
        const cacheKey = CACHE_PREFIX + key;
        const cached = this.storage.getItem(cacheKey);

        if (!cached) {
            return null;
        }

        try {
            const { timestamp } = JSON.parse(cached);
            return timestamp ? Date.now() - timestamp : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Get or fetch data with caching
     * @param {string} key - Cache key
     * @param {Function} fetchFn - Function to fetch data if not cached
     * @param {number} ttl - Time to live in milliseconds
     * @returns {Promise<any>} Cached or fetched data
     */
    async getOrFetch(key, fetchFn, ttl = DEFAULT_TTL) {
        // Return cached data if available
        const cached = this.get(key);
        if (cached !== null) {
            return cached;
        }

        // Fetch fresh data
        const data = await fetchFn();

        // Cache the result
        this.set(key, data, ttl);

        return data;
    }
}

// Export cache instances
export const sessionCache = new Cache(sessionStorage);
export const localCache = new Cache(localStorage);

// Default export is session cache
export default sessionCache;

/**
 * Draft picks storage (uses localStorage for persistence)
 */
export const draftStorage = {
    PICKED_KEY: 'npl_draft_picked',
    WATCHING_KEY: 'npl_draft_watching',

    getPicked() {
        try {
            return JSON.parse(localStorage.getItem(this.PICKED_KEY)) || [];
        } catch {
            return [];
        }
    },

    setPicked(picks) {
        localStorage.setItem(this.PICKED_KEY, JSON.stringify(picks));
    },

    addPicked(mlbId) {
        const picked = this.getPicked();
        if (!picked.includes(mlbId)) {
            picked.push(mlbId);
            this.setPicked(picked);
        }
    },

    removePicked(mlbId) {
        const picked = this.getPicked().filter(id => id !== mlbId);
        this.setPicked(picked);
    },

    isPicked(mlbId) {
        return this.getPicked().includes(mlbId);
    },

    getWatching() {
        try {
            return JSON.parse(localStorage.getItem(this.WATCHING_KEY)) || [];
        } catch {
            return [];
        }
    },

    setWatching(watching) {
        localStorage.setItem(this.WATCHING_KEY, JSON.stringify(watching));
    },

    addWatching(mlbId) {
        const watching = this.getWatching();
        if (!watching.includes(mlbId)) {
            watching.push(mlbId);
            this.setWatching(watching);
        }
    },

    removeWatching(mlbId) {
        const watching = this.getWatching().filter(id => id !== mlbId);
        this.setWatching(watching);
    },

    isWatching(mlbId) {
        return this.getWatching().includes(mlbId);
    },

    toggleWatching(mlbId) {
        if (this.isWatching(mlbId)) {
            this.removeWatching(mlbId);
            return false;
        } else {
            this.addWatching(mlbId);
            return true;
        }
    },

    togglePicked(mlbId) {
        if (this.isPicked(mlbId)) {
            this.removePicked(mlbId);
            return false;
        } else {
            this.addPicked(mlbId);
            return true;
        }
    },

    clear() {
        localStorage.removeItem(this.PICKED_KEY);
        localStorage.removeItem(this.WATCHING_KEY);
    },
};
