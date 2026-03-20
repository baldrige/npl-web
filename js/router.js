/**
 * Hash-based SPA Router
 * Handles navigation between views without page reloads
 */

class Router {
    constructor() {
        this.routes = {};
        this.currentView = null;
        this.viewContainer = null;
    }

    /**
     * Initialize the router
     * @param {string} containerId - ID of the container element for views
     */
    init(containerId) {
        this.viewContainer = document.getElementById(containerId);

        // Listen for hash changes
        window.addEventListener('hashchange', () => this.handleRoute());

        // Handle initial route
        this.handleRoute();
    }

    /**
     * Register a route
     * @param {string} path - Route path (e.g., 'home', 'rosters')
     * @param {Function} handler - View render function
     */
    register(path, handler) {
        this.routes[path] = handler;
    }

    /**
     * Navigate to a route
     * @param {string} path - Route path
     * @param {Object} params - Optional route parameters
     */
    navigate(path, params = {}) {
        const queryString = Object.keys(params).length
            ? '?' + new URLSearchParams(params).toString()
            : '';
        window.location.hash = `#/${path}${queryString}`;
    }

    /**
     * Handle the current route
     */
    handleRoute() {
        // Parse the hash
        const hash = window.location.hash.slice(1) || '/home';
        const [path, queryString] = hash.split('?');
        const routePath = path.slice(1) || 'home'; // Remove leading /

        // Parse query parameters
        const params = {};
        if (queryString) {
            const searchParams = new URLSearchParams(queryString);
            for (const [key, value] of searchParams) {
                params[key] = value;
            }
        }

        // Find matching route
        const handler = this.routes[routePath];

        if (handler) {
            this.renderView(routePath, handler, params);
        } else {
            // 404 - Route not found, redirect to home
            this.navigate('home');
        }
    }

    /**
     * Render a view
     * @param {string} name - View name
     * @param {Function} handler - View render function
     * @param {Object} params - Route parameters
     */
    async renderView(name, handler, params) {
        // Update active nav link
        this.updateNavLinks(name);

        // Clear current view
        if (this.viewContainer) {
            this.viewContainer.innerHTML = '';
        }

        // Show loading state
        this.showLoading(true);

        try {
            // Render the new view
            const viewContent = await handler(params);

            if (this.viewContainer) {
                if (typeof viewContent === 'string') {
                    this.viewContainer.innerHTML = viewContent;
                } else if (viewContent instanceof HTMLElement) {
                    this.viewContainer.appendChild(viewContent);
                }
            }

            this.currentView = name;
        } catch (error) {
            console.error(`Error rendering view ${name}:`, error);
            this.viewContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">!</div>
                    <h3>Error Loading View</h3>
                    <p>${error.message}</p>
                </div>
            `;
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * Update navigation link active states
     * @param {string} currentRoute - Current route name
     */
    updateNavLinks(currentRoute) {
        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            const linkRoute = link.getAttribute('data-route');
            if (linkRoute === currentRoute) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });
    }

    /**
     * Show/hide loading indicator
     * @param {boolean} show - Whether to show loading
     */
    showLoading(show) {
        const loader = document.getElementById('loading-indicator');
        if (loader) {
            loader.classList.toggle('hidden', !show);
        }
    }

    /**
     * Get current route parameters
     * @returns {Object} Current route parameters
     */
    getParams() {
        const hash = window.location.hash.slice(1) || '/home';
        const [, queryString] = hash.split('?');
        const params = {};

        if (queryString) {
            const searchParams = new URLSearchParams(queryString);
            for (const [key, value] of searchParams) {
                params[key] = value;
            }
        }

        return params;
    }

    /**
     * Get current route name
     * @returns {string} Current route name
     */
    getCurrentRoute() {
        const hash = window.location.hash.slice(1) || '/home';
        const [path] = hash.split('?');
        return path.slice(1) || 'home';
    }
}

// Export singleton instance
export const router = new Router();
