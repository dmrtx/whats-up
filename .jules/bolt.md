## 2025-05-23 - [Layout Thrashing in MutationObservers]
**Learning:** Checking layout properties (like `getBoundingClientRect` or `getComputedStyle`) inside `MutationObserver` callbacks forces synchronous layout recalculation for every added node. This is disastrous for performance in chat applications with frequent DOM updates.
**Action:** Always filter nodes using cheap DOM properties (tagName, child count, querySelector) before accessing layout properties. Order checks from cheapest to most expensive.
