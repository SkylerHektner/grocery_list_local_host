// DOM Elements for Items
const newItemBtn = document.getElementById("new-item-btn");
const newItemModalBackdrop = document.getElementById("new-item-modal-backdrop");
const newItemCancelBtn = document.getElementById("new-item-cancel-btn");
const newItemSubmitBtn = document.getElementById("new-item-submit-btn");
const newItemInput = document.getElementById("item-input");
const newItemCategory = document.getElementById("item-category");
const itemsList = document.getElementById("items-list");

// edit item
const editItemModalBackdrop = document.getElementById(
  "edit-item-modal-backdrop",
);
const editItemCancelBtn = document.getElementById("edit-item-cancel-btn");
const editItemSubmitBtn = document.getElementById("edit-item-submit-btn");
const editItemInput = document.getElementById("edit-item-input");
const editItemCategory = document.getElementById("edit-item-category");

// delete item
const deleteItemModalBackdrop = document.getElementById(
  "delete-item-modal-backdrop",
);
const deleteItemCancelBtn = document.getElementById("delete-item-cancel-btn");
const deleteItemSubmitBtn = document.getElementById("delete-item-submit-btn");
const deleteItemNameDisplay = document.getElementById(
  "delete-item-name-display",
);

// grocery list
const clearGroceryListBtn = document.getElementById("clear-grocery-list-btn");

export let currentItems = [];
let editItemTargetName = "";
let deleteItemTargetName = "";

function emitGroceryListEvent(eventName, name) {
  document.dispatchEvent(
    new CustomEvent(eventName, {
      detail: { name },
    }),
  );
}

export async function fetchAndPopulateCategories() {
  try {
    const response = await fetch("/api/categories");
    if (response.ok) {
      const categories = await response.json();
      categories.forEach((category) => {
        // Add to main modal
        const option = document.createElement("option");
        option.value = category;
        option.textContent = category;
        newItemCategory.appendChild(option);

        // Add to edit modal
        const editOption = document.createElement("option");
        editOption.value = category;
        editOption.textContent = category;
        editItemCategory.appendChild(editOption);
      });
    } else {
      alert(await response.text() || "Failed to fetch categories");
    }
  } catch (error) {
    console.error("Error fetching categories:", error);
  }
}

export async function fetchAndDisplayItems() {
  try {
    const response = await fetch("/api/items");
    const groceryResponse = await fetch("/api/grocery_list");
    if (response.ok && groceryResponse.ok) {
      const items = await response.json();
      const groceryItems = await groceryResponse.json();
      currentItems = items; // Store for duplicate checking
      itemsList.innerHTML = ""; // Clear current list

      if (items.length === 0) {
        itemsList.innerHTML =
          '<li class="empty-message">No items added yet.</li>';
        return;
      }

      // Sort items by category, then by name
      items.sort((a, b) => {
        if (a.category === b.category) {
          return a.name.localeCompare(b.name);
        }
        return a.category.localeCompare(b.category);
      });

      let currentCategory = null;
      let currentCategoryGridList = null;

      items.forEach((item) => {
        if (item.category !== currentCategory) {
          const categoryHeader = document.createElement("li");
          categoryHeader.className = "category-header";
          categoryHeader.textContent = item.category;
          categoryHeader.style.marginTop =
            currentCategory === null ? "0" : "1rem";
          itemsList.appendChild(categoryHeader);
          currentCategory = item.category;

          currentCategoryGridList = document.createElement("ul");
          currentCategoryGridList.className = "grid-list";
          itemsList.appendChild(currentCategoryGridList);
        }

        const li = document.createElement("li");
        li.style.display = "flex";
        li.style.justifyContent = "space-between";
        li.style.alignItems = "center";
        li.tabIndex = -1;
        li.dataset.itemName = item.name;
        li.dataset.inGroceryList = groceryItems.some(
          (groceryItem) =>
            groceryItem.toLowerCase() === item.name.toLowerCase(),
        )
          ? "true"
          : "false";
        if (li.dataset.inGroceryList === "true") {
          li.classList.add("in-grocery-list");
        }

        li.addEventListener("keydown", (e) => {
          if (e.key === "ArrowUp") {
            if (moveFocusedItem(-1, li)) {
              e.preventDefault();
            }
            return;
          }

          if (e.key === "ArrowDown") {
            if (moveFocusedItem(1, li)) {
              e.preventDefault();
            }
            return;
          }

          if (e.key === "Enter") {
            li.click();
            e.preventDefault();
          }
        });

        li.addEventListener("click", () => {
          if (li.dataset.inGroceryList === "true") {
            console.log("Removing from grocery list:", item.name);
            resetTypeaheadBuffer();
            emitGroceryListEvent("remove-item-from-grocery-list", item.name);
          } else {
            console.log("Adding to grocery list:", item.name);
            resetTypeaheadBuffer();
            emitGroceryListEvent("add-item-to-grocery-list", item.name);
          }
        });

        const nameSpan = document.createElement("span");
        nameSpan.textContent = item.name;
        nameSpan.classList.add("unselectable");

        const infoDiv = document.createElement("div");
        infoDiv.style.display = "flex";
        infoDiv.style.alignItems = "center";
        infoDiv.style.gap = "0.5rem";
        infoDiv.appendChild(nameSpan);

        const actionsDiv = document.createElement("div");
        actionsDiv.className = "item-actions";

        const editBtn = document.createElement("button");
        editBtn.className = "icon-btn";
        editBtn.textContent = "✏️";
        editBtn.title = "Edit Item";
        editBtn.addEventListener("click", (event) => {
          event.stopPropagation(); // Prevent triggering the add/remove grocery list action
          editItemTargetName = item.name;
          editItemInput.value = item.name;
          editItemCategory.value = item.category;
          editItemModalBackdrop.classList.remove("hidden");
          editItemInput.focus();
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "icon-btn";
        deleteBtn.textContent = "🗑️";
        deleteBtn.title = "Delete Item";
        deleteBtn.addEventListener("click", (event) => {
          event.stopPropagation(); // Prevent triggering the add/remove grocery list action
          deleteItemTargetName = item.name;
          deleteItemNameDisplay.textContent = item.name;
          deleteItemModalBackdrop.classList.remove("hidden");
        });

        actionsDiv.appendChild(editBtn);
        actionsDiv.appendChild(deleteBtn);

        li.appendChild(infoDiv);
        li.appendChild(actionsDiv);
        currentCategoryGridList.appendChild(li);
      });
    } else {
      console.error("Failed to fetch items");
      itemsList.innerHTML =
        '<li class="empty-message">Failed to load items.</li>';
    }
  } catch (error) {
    console.error("Error fetching items:", error);
    itemsList.innerHTML =
      '<li class="empty-message">Error connecting to server.</li>';
  }
}

// Open modal
newItemBtn.addEventListener("click", () => {
  newItemModalBackdrop.classList.remove("hidden");
  newItemInput.value = "";
  newItemInput.focus();
});

// Close modal
newItemCancelBtn.addEventListener("click", () => {
  newItemModalBackdrop.classList.add("hidden");
});

// Handle submit
newItemSubmitBtn.addEventListener("click", async () => {
  const name = newItemInput.value.trim();
  const category = newItemCategory.value;

  if (!name || !category) {
    alert("Please enter a name and select a category.");
    return;
  }

  // Check for duplicates
  const isDuplicate = currentItems.some(
    (item) => item.name.toLowerCase() === name.toLowerCase(),
  );

  if (isDuplicate) {
    alert(`The item "${name}" already exists!`);
    return;
  }

  try {
    const response = await fetch("/api/items", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: name, category: category }),
    });

    if (response.ok) {
      newItemInput.value = ""; // Clear input on success
      newItemCategory.value = ""; // Clear category
      newItemModalBackdrop.classList.add("hidden");
      await fetchAndDisplayItems(); // Refresh the list
    } else if (response.status === 409) {
      const msg = await response.text();
      alert(msg);
    } else {
      alert(await response.text() || "Failed to add item.");
    }
  } catch (error) {
    console.error("Error:", error);
    alert("An error occurred.");
  }
});

// Edit Handlers
editItemCancelBtn.addEventListener("click", () => {
  editItemModalBackdrop.classList.add("hidden");
});

editItemInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    editItemSubmitBtn.click();
  }
});

editItemSubmitBtn.addEventListener("click", async () => {
  const name = editItemInput.value.trim();
  const category = editItemCategory.value;

  if (!name || !category) {
    alert("Please enter a name and select a category.");
    return;
  }

  // Check for duplicates if the name changed
  if (name.toLowerCase() !== editItemTargetName.toLowerCase()) {
    const isDuplicate = currentItems.some(
      (item) => item.name.toLowerCase() === name.toLowerCase(),
    );

    if (isDuplicate) {
      alert(`The item "${name}" is already on your list!`);
      return;
    }
  }

  try {
    const response = await fetch(
      `/api/items/${encodeURIComponent(editItemTargetName)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: name, category: category }),
      },
    );

    if (response.ok) {
      editItemModalBackdrop.classList.add("hidden");
      await fetchAndDisplayItems(); // Refresh the list
    } else {
      alert(await response.text() || "Failed to update item.");
    }
  } catch (error) {
    console.error("Error:", error);
    alert("An error occurred.");
  }
});

// Delete Handlers
deleteItemCancelBtn.addEventListener("click", () => {
  deleteItemModalBackdrop.classList.add("hidden");
});

deleteItemSubmitBtn.addEventListener("click", async () => {
  try {
    const response = await fetch(
      `/api/items/${encodeURIComponent(deleteItemTargetName)}`,
      {
        method: "DELETE",
      },
    );

    if (response.ok) {
      deleteItemModalBackdrop.classList.add("hidden");
      await fetchAndDisplayItems(); // Refresh the list
    } else {
      alert(await response.text() || "Failed to delete item.");
    }
  } catch (error) {
    console.error("Error:", error);
    alert("An error occurred.");
  }
});

// Move focus using arrow keys

function moveFocusedItem(direction, currentElement) {
  const itemElements = getFocusableItemElements();
  const currentIndex = itemElements.findIndex(
    (element) => element === currentElement,
  );

  if (currentIndex === -1) {
    return false;
  }

  const nextIndex = currentIndex + direction;
  const nextElement = itemElements[nextIndex];

  if (!nextElement) {
    return false;
  }

  nextElement.focus();
  nextElement.scrollIntoView({ block: "nearest" });
  return true;
}

// global search

let typeaheadBuffer = "";
let typeaheadResetTimeout = null;

function isTypingContext(element) {
  if (!element) {
    return false;
  }

  const tagName = element.tagName;
  return (
    element.isContentEditable ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT"
  );
}

function resetTypeaheadBuffer() {
  typeaheadBuffer = "";

  if (typeaheadResetTimeout) {
    clearTimeout(typeaheadResetTimeout);
    typeaheadResetTimeout = null;
  }
}

function scheduleTypeaheadReset() {
  if (typeaheadResetTimeout) {
    clearTimeout(typeaheadResetTimeout);
  }

  typeaheadResetTimeout = setTimeout(() => {
    typeaheadBuffer = "";
    typeaheadResetTimeout = null;
  }, 1000);
}

function getFocusableItemElements() {
  return Array.from(itemsList.querySelectorAll("li[data-item-name]"));
}

function focusMatchingItem(searchText) {
  if (!searchText) {
    return false;
  }

  const itemElements = getFocusableItemElements();

  if (itemElements.length === 0) {
    return false;
  }

  const normalizedSearch = searchText.toLowerCase();
  const activeIndex = itemElements.findIndex(
    (element) => element === document.activeElement,
  );

  const orderedElements =
    activeIndex >= 0
      ? [
          ...itemElements.slice(activeIndex + 1),
          ...itemElements.slice(0, activeIndex + 1),
        ]
      : itemElements;

  const match = orderedElements.find((element) =>
    element.dataset.itemName.toLowerCase().startsWith(normalizedSearch),
  );

  if (!match) {
    return false;
  }

  match.focus();
  match.scrollIntoView({ block: "nearest" });
  return true;
}

function handleGlobalItemTypeahead(event) {
  if (
    event.defaultPrevented ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    isTypingContext(event.target)
  ) {
    return;
  }

  if (event.key === "Escape") {
    resetTypeaheadBuffer();
    return;
  }

  if (event.key.length !== 1 || event.key.trim() === "") {
    return;
  }

  const nextBuffer = `${typeaheadBuffer}${event.key.toLowerCase()}`;

  if (focusMatchingItem(nextBuffer)) {
    typeaheadBuffer = nextBuffer;
    scheduleTypeaheadReset();
    event.preventDefault();
    return;
  }

  if (focusMatchingItem(event.key)) {
    typeaheadBuffer = event.key.toLowerCase();
    scheduleTypeaheadReset();
    event.preventDefault();
    return;
  }

  resetTypeaheadBuffer();
}

document.addEventListener("keydown", handleGlobalItemTypeahead);

// Grocery List Events from Items List

async function addToGroceryList(name) {
  try {
    const response = await fetch("/api/grocery_list", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name }),
    });

    if (response.ok) {
      await fetchAndDisplayItems();
    } else if (response.status === 409) {
      // Ignore conflict silently or show a small toast, but simple alert for now
      console.log(`Item "${name}" already in grocery list`);
    } else {
      alert(await response.text() || "Failed to add to grocery list.");
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

async function removeFromGroceryList(name) {
  try {
    const response = await fetch("/api/grocery_list/delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name }),
    });

    if (response.ok) {
      await fetchAndDisplayItems();
    } else if (response.status === 404) {
      console.log(`Item "${name}" was not found in the grocery list`);
    } else {
      alert(await response.text() || "Failed to remove item from grocery list.");
    }
  } catch (error) {
    console.error("Error removing grocery list item:", error);
  }
}

document.addEventListener("add-item-to-grocery-list", async (event) => {
  const itemName = event.detail?.name;
  if (itemName) {
    await addToGroceryList(itemName);
  }
});

document.addEventListener("remove-item-from-grocery-list", async (event) => {
  const itemName = event.detail?.name;
  if (itemName) {
    await removeFromGroceryList(itemName);
  }
});

clearGroceryListBtn.addEventListener("click", async () => {
  if (confirm("Are you sure you want to clear your entire grocery list?")) {
    try {
      const response = await fetch("/api/grocery_list", {
        method: "DELETE",
      });
      if (response.ok) {
        await fetchAndDisplayItems();
      } else {
        alert(await response.text() || "Failed to clear grocery list");
      }
    } catch (error) {
      console.error("Error clearing grocery list:", error);
    }
  }
});