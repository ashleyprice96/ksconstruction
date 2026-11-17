"use client";

import { applyFilters } from "./tableFilters";

export default function HeaderSearch() {
  return (
    <label className="search">
      <span className="sr-only">Search this page</span>
      <input
        type="search"
        placeholder="Search"
        autoComplete="off"
        onInput={(e) => {
          document.body.dataset.ksSearch = e.currentTarget.value;
          document.querySelectorAll<HTMLTableElement>("main table").forEach((table) => applyFilters(table));
        }}
      />
    </label>
  );
}
