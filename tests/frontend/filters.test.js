const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeEvent {
    constructor(type, options = {}) {
        this.type = type;
        this.bubbles = !!options.bubbles;
        this.cancelable = !!options.cancelable;
        this.defaultPrevented = false;
        this.target = null;
        this.currentTarget = null;
    }

    preventDefault() {
        this.defaultPrevented = true;
    }
}

class FakeElement {
    constructor(tagName, id = null) {
        this.tagName = tagName.toUpperCase();
        this.id = id;
        this.value = '';
        this.placeholder = '';
        this.className = '';
        this.disabled = false;
        this.style = {};
        this.children = [];
        this.listeners = {};
        this.attributes = {};
        this._innerHTML = '';
        this._textContent = '';
    }

    addEventListener(type, handler) {
        if (!this.listeners[type]) {
            this.listeners[type] = [];
        }
        this.listeners[type].push(handler);
    }

    dispatchEvent(event) {
        event.target = event.target || this;
        event.currentTarget = this;

        (this.listeners[event.type] || []).forEach((handler) => {
            handler.call(this, event);
        });

        return !event.defaultPrevented;
    }

    appendChild(child) {
        this.children.push(child);
    }

    setAttribute(name, value) {
        this.attributes[name] = value;
    }

    getAttribute(name) {
        return this.attributes[name] || null;
    }

    set innerHTML(value) {
        this._innerHTML = value;
        if (value === '') {
            this.children = [];
        }
    }

    get innerHTML() {
        return this._innerHTML;
    }

    set textContent(value) {
        this._textContent = value;
    }

    get textContent() {
        const ownText = this._textContent || this._innerHTML.replace(/<[^>]+>/g, '');
        const childText = this.children.map((child) => child.textContent).join('');
        return `${ownText}${childText}`;
    }
}

function createTestContext() {
    const elements = {
        'filter-form': new FakeElement('form', 'filter-form'),
        'filter-field': new FakeElement('select', 'filter-field'),
        'filter-value': new FakeElement('input', 'filter-value'),
        'add-filter-btn': new FakeElement('button', 'add-filter-btn'),
        'active-filters': new FakeElement('div', 'active-filters')
    };

    const document = {
        getElementById(id) {
            return elements[id];
        },
        createElement(tagName) {
            return new FakeElement(tagName);
        }
    };

    const window = {
        location: new URL('https://example.test/?page=2&pageSize=25'),
        history: {
            pushState(_state, _title, url) {
                window.location = new URL(url.toString());
            }
        },
        Event: FakeEvent
    };

    const context = {
        window,
        document,
        URL,
        URLSearchParams,
        console,
        setTimeout: (callback) => {
            callback();
            return 0;
        },
        fetchJobs: jest.fn()
    };

    window.fetchJobs = context.fetchJobs;

    return {
        context: vm.createContext(context),
        elements,
        window
    };
}

describe('Frontend Filters', () => {
    let testContext;
    let elements;
    let window;

    beforeEach(() => {
        testContext = createTestContext();
        elements = testContext.elements;
        window = testContext.window;

        const scriptPath = path.resolve(__dirname, '../../public/js/filters.js');
        const scriptContent = fs.readFileSync(scriptPath, 'utf8');
        vm.runInContext(scriptContent, testContext.context);
        testContext.context.initializeFilters();
    });

    test('submitting a new filter updates the URL, badges, and jobs table immediately', () => {
        elements['filter-field'].value = 'user';
        elements['filter-value'].value = 'alice';

        elements['filter-form'].dispatchEvent(new window.Event('submit', {
            bubbles: true,
            cancelable: true
        }));

        expect(window.activeFilters).toEqual({
            page: 1,
            pageSize: 25,
            user: 'alice'
        });
        expect(window.location.search).toBe('?page=1&pageSize=25&user=alice');
        expect(elements['active-filters'].textContent).toContain('user: alice');
        expect(testContext.context.fetchJobs).toHaveBeenCalledWith({
            page: 1,
            pageSize: 25,
            user: 'alice'
        });
        expect(elements['filter-value'].value).toBe('');
    });
});
