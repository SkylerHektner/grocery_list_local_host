const addItemBtn = document.getElementById("add-item-btn");
const modalBackdrop = document.getElementById("modal-backdrop");
const cancelBtn = document.getElementById("cancel-btn");
const submitBtn = document.getElementById("submit-btn");
const itemInput = document.getElementById("item-input");
const itemCategory = document.getElementById("item-category");
const itemsList = document.getElementById("items-list");

const editModalBackdrop = document.getElementById("edit-modal-backdrop");
const editCancelBtn = document.getElementById("edit-cancel-btn");
const editSubmitBtn = document.getElementById("edit-submit-btn");
const editItemInput = document.getElementById("edit-item-input");
const editItemCategory = document.getElementById("edit-item-category");

const deleteModalBackdrop = document.getElementById("delete-modal-backdrop");
const deleteCancelBtn = document.getElementById("delete-cancel-btn");
const deleteSubmitBtn = document.getElementById("delete-submit-btn");
const deleteItemNameDisplay = document.getElementById(
  "delete-item-name-display",
);

let currentItems = [];
let editItemTargetName = "";
let deleteItemTargetName = "";

// Fetch and populate categories
async function fetchAndPopulateCategories() {
  try {
    const response = await fetch("/api/categories");
    if (response.ok) {
      const categories = await response.json();
      categories.forEach((category) => {
        // Add to main modal
        const option = document.createElement("option");
        option.value = category;
        option.textContent = category;
        itemCategory.appendChild(option);

        // Add to edit modal
        const editOption = document.createElement("option");
        editOption.value = category;
        editOption.textContent = category;
        editItemCategory.appendChild(editOption);
      });
    } else {
      console.error("Failed to fetch categories");
    }
  } catch (error) {
    console.error("Error fetching categories:", error);
  }
}

// Fetch and display items from the server
async function fetchAndDisplayItems() {
  try {
    const response = await fetch("/api/items");
    if (response.ok) {
      const items = await response.json();
      currentItems = items; // Store for duplicate checking
      itemsList.innerHTML = ""; // Clear current list

      if (items.length === 0) {
        itemsList.innerHTML =
          '<li class="empty-message">No items added yet.</li>';
        return;
      }

      items.forEach((item) => {
        const li = document.createElement("li");
        li.style.display = "flex";
        li.style.justifyContent = "space-between";
        li.style.alignItems = "center";

        const nameSpan = document.createElement("span");
        nameSpan.textContent = item.name;

        const categorySpan = document.createElement("span");
        categorySpan.className = "category-tag";
        categorySpan.textContent = item.category;

        const infoDiv = document.createElement("div");
        infoDiv.style.display = "flex";
        infoDiv.style.alignItems = "center";
        infoDiv.style.gap = "0.5rem";
        infoDiv.appendChild(nameSpan);
        infoDiv.appendChild(categorySpan);

        const actionsDiv = document.createElement("div");
        actionsDiv.className = "item-actions";

        const editBtn = document.createElement("button");
        editBtn.className = "icon-btn";
        editBtn.textContent = "✏️";
        editBtn.title = "Edit Item";
        editBtn.addEventListener("click", () => {
          editItemTargetName = item.name;
          editItemInput.value = item.name;
          editItemCategory.value = item.category;
          editModalBackdrop.classList.remove("hidden");
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "icon-btn";
        deleteBtn.textContent = "🗑️";
        deleteBtn.title = "Delete Item";
        deleteBtn.addEventListener("click", () => {
          deleteItemTargetName = item.name;
          deleteItemNameDisplay.textContent = item.name;
          deleteModalBackdrop.classList.remove("hidden");
        });

        actionsDiv.appendChild(editBtn);
        actionsDiv.appendChild(deleteBtn);

        li.appendChild(infoDiv);
        li.appendChild(actionsDiv);
        itemsList.appendChild(li);
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
addItemBtn.addEventListener("click", () => {
  modalBackdrop.classList.remove("hidden");
  itemInput.value = "";
  itemInput.focus();
});

// Close modal
cancelBtn.addEventListener("click", () => {
  modalBackdrop.classList.add("hidden");
});

// Handle submit
submitBtn.addEventListener("click", async () => {
  const name = itemInput.value.trim();
  const category = itemCategory.value;

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
      itemInput.value = ""; // Clear input on success
      itemCategory.value = ""; // Clear category
      modalBackdrop.classList.add("hidden");
      await fetchAndDisplayItems(); // Refresh the list
    } else if (response.status === 409) {
      const msg = await response.text();
      alert(msg);
    } else {
      alert("Failed to add item.");
    }
  } catch (error) {
    console.error("Error:", error);
    alert("An error occurred.");
  }
});

// Edit Handlers
editCancelBtn.addEventListener("click", () => {
  editModalBackdrop.classList.add("hidden");
});

editSubmitBtn.addEventListener("click", async () => {
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
      editModalBackdrop.classList.add("hidden");
      await fetchAndDisplayItems(); // Refresh the list
    } else {
      alert("Failed to update item.");
    }
  } catch (error) {
    console.error("Error:", error);
    alert("An error occurred.");
  }
});

// Delete Handlers
deleteCancelBtn.addEventListener("click", () => {
  deleteModalBackdrop.classList.add("hidden");
});

deleteSubmitBtn.addEventListener("click", async () => {
  try {
    const response = await fetch(
      `/api/items/${encodeURIComponent(deleteItemTargetName)}`,
      {
        method: "DELETE",
      },
    );

    if (response.ok) {
      deleteModalBackdrop.classList.add("hidden");
      await fetchAndDisplayItems(); // Refresh the list
    } else {
      alert("Failed to delete item.");
    }
  } catch (error) {
    console.error("Error:", error);
    alert("An error occurred.");
  }
});

// Load data when the page starts
fetchAndPopulateCategories();
fetchAndDisplayItems();
