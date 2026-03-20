/**
 * Search Box Component
 * Input with debounced search and clear button
 */

import { debounce } from '../utils/dataTransform.js';

/**
 * Create a search box
 * @param {Object} options - Search box options
 * @returns {HTMLElement} Search box element
 */
export function createSearchBox(options = {}) {
    const {
        placeholder = 'Search...',
        debounceMs = 300,
        onSearch = () => {},
        initialValue = '',
    } = options;

    const wrapper = document.createElement('div');
    wrapper.className = 'search-box';

    wrapper.innerHTML = `
        <span class="search-box-icon">&#128269;</span>
        <input
            type="text"
            class="search-box-input"
            placeholder="${placeholder}"
            value="${initialValue}"
        />
        <button class="search-box-clear ${initialValue ? '' : 'hidden'}" type="button">
            &times;
        </button>
    `;

    const input = wrapper.querySelector('.search-box-input');
    const clearBtn = wrapper.querySelector('.search-box-clear');

    // Debounced search handler
    const debouncedSearch = debounce((value) => {
        onSearch(value);
    }, debounceMs);

    // Input event
    input.addEventListener('input', (e) => {
        const value = e.target.value;
        clearBtn.classList.toggle('hidden', !value);
        debouncedSearch(value);
    });

    // Clear button
    clearBtn.addEventListener('click', () => {
        input.value = '';
        clearBtn.classList.add('hidden');
        onSearch('');
        input.focus();
    });

    // Keyboard shortcut (Escape to clear)
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            input.value = '';
            clearBtn.classList.add('hidden');
            onSearch('');
        }
    });

    // Public methods
    wrapper.getValue = () => input.value;
    wrapper.setValue = (value) => {
        input.value = value;
        clearBtn.classList.toggle('hidden', !value);
    };
    wrapper.focus = () => input.focus();
    wrapper.clear = () => {
        input.value = '';
        clearBtn.classList.add('hidden');
        onSearch('');
    };

    return wrapper;
}

/**
 * Create a filter select dropdown
 * @param {Object} options - Select options
 * @returns {HTMLElement} Select element
 */
export function createFilterSelect(options = {}) {
    const {
        label = '',
        options: selectOptions = [],
        onChange = () => {},
        initialValue = '',
    } = options;

    const wrapper = document.createElement('div');
    wrapper.className = 'filter-group';

    wrapper.innerHTML = `
        ${label ? `<label>${label}</label>` : ''}
        <select class="filter-select">
            ${selectOptions.map(opt => {
                const value = typeof opt === 'object' ? opt.value : opt;
                const text = typeof opt === 'object' ? opt.label : opt;
                const selected = value === initialValue ? 'selected' : '';
                return `<option value="${value}" ${selected}>${text}</option>`;
            }).join('')}
        </select>
    `;

    const select = wrapper.querySelector('.filter-select');

    select.addEventListener('change', (e) => {
        onChange(e.target.value);
    });

    // Public methods
    wrapper.getValue = () => select.value;
    wrapper.setValue = (value) => {
        select.value = value;
    };

    return wrapper;
}

/**
 * Create position filter buttons
 * @param {Object} options - Filter options
 * @returns {HTMLElement} Filter element
 */
export function createPositionFilter(options = {}) {
    const {
        positions = ['ALL', 'P', 'C', '1B', '2B', '3B', 'SS', 'OF', 'DH'],
        onChange = () => {},
        initialValue = 'ALL',
    } = options;

    const wrapper = document.createElement('div');
    wrapper.className = 'filter-group';

    wrapper.innerHTML = `
        <label>Position</label>
        <div class="position-filter flex gap-sm flex-wrap">
            ${positions.map(pos => `
                <button
                    type="button"
                    class="btn btn-sm ${pos === initialValue ? 'btn-primary' : 'btn-secondary'}"
                    data-position="${pos}"
                >
                    ${pos}
                </button>
            `).join('')}
        </div>
    `;

    let currentValue = initialValue;

    wrapper.querySelectorAll('[data-position]').forEach(btn => {
        btn.addEventListener('click', () => {
            // Update active state
            wrapper.querySelectorAll('[data-position]').forEach(b => {
                b.classList.remove('btn-primary');
                b.classList.add('btn-secondary');
            });
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-primary');

            currentValue = btn.dataset.position;
            onChange(currentValue);
        });
    });

    // Public methods
    wrapper.getValue = () => currentValue;
    wrapper.setValue = (value) => {
        currentValue = value;
        wrapper.querySelectorAll('[data-position]').forEach(btn => {
            btn.classList.toggle('btn-primary', btn.dataset.position === value);
            btn.classList.toggle('btn-secondary', btn.dataset.position !== value);
        });
    };

    return wrapper;
}

/**
 * Create a team selector
 * @param {Array} teams - Array of team objects
 * @param {Object} options - Selector options
 * @returns {HTMLElement} Team selector element
 */
export function createTeamSelector(teams, options = {}) {
    const {
        onChange = () => {},
        initialValue = null,
        showAll = true,
    } = options;

    const wrapper = document.createElement('div');
    wrapper.className = 'filter-group';

    const allTeams = showAll ? [{ id: '', name: 'All Teams' }, ...teams] : teams;

    wrapper.innerHTML = `
        <label>NPL Team</label>
        <select class="filter-select team-select">
            ${allTeams.map(team => `
                <option value="${team.id}" ${team.id === initialValue ? 'selected' : ''}>
                    ${team.name}
                </option>
            `).join('')}
        </select>
    `;

    const select = wrapper.querySelector('.team-select');

    select.addEventListener('change', (e) => {
        onChange(e.target.value);
    });

    // Public methods
    wrapper.getValue = () => select.value;
    wrapper.setValue = (value) => {
        select.value = value;
    };

    return wrapper;
}
