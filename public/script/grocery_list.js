import { currentItems } from "./items.js";

const groceryContainer = document.getElementById("grocery-container");
const groceryList = document.getElementById("grocery-list");
const clearGroceryListBtn = document.getElementById("clear-grocery-list-btn");
const dropHint = document.getElementById("drop-hint");

export async function fetchAndDisplayGroceryList() {
  try {
    const response = await fetch("/api/grocery_list");
    if (response.ok) {
      const groceryItems = await response.json();
      groceryList.innerHTML = "";

      if (groceryItems.length === 0) {
        dropHint.style.display = "block";
        groceryList.innerHTML = "";
        return;
      }

      dropHint.style.display = "none";
      groceryItems.forEach((name) => {
        const li = document.createElement("li");
        li.style.display = "flex";
        li.style.justifyContent = "space-between";
        li.style.alignItems = "center";

        const nameSpan = document.createElement("span");
        nameSpan.textContent = name;

        // Find category from current items
        const itemInfo = currentItems.find(
          (i) => i.name.toLowerCase() === name.toLowerCase(),
        );
        const categorySpan = document.createElement("span");
        categorySpan.className = "category-tag";
        categorySpan.textContent = itemInfo ? itemInfo.category : "Unknown";

        const infoDiv = document.createElement("div");
        infoDiv.style.display = "flex";
        infoDiv.style.alignItems = "center";
        infoDiv.style.gap = "0.5rem";
        infoDiv.appendChild(nameSpan);
        infoDiv.appendChild(categorySpan);

        li.appendChild(infoDiv);
        groceryList.appendChild(li);
      });
    } else {
      console.error("Failed to fetch grocery list");
    }
  } catch (error) {
    console.error("Error fetching grocery list:", error);
  }
}

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
      await fetchAndDisplayGroceryList();
    } else if (response.status === 409) {
      // Ignore conflict silently or show a small toast, but simple alert for now
      console.log(`Item "${name}" already in grocery list`);
    } else {
      alert("Failed to add to grocery list.");
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

// Drag and drop event listeners
groceryContainer.addEventListener("dragover", (e) => {
  e.preventDefault();
  groceryContainer.classList.add("drag-over");
});

groceryContainer.addEventListener("dragleave", () => {
  groceryContainer.classList.remove("drag-over");
});

groceryContainer.addEventListener("drop", async (e) => {
  e.preventDefault();
  groceryContainer.classList.remove("drag-over");

  const itemName = e.dataTransfer.getData("text/plain");
  if (itemName) {
    await addToGroceryList(itemName);
  }
});

// Clear grocery list listener
clearGroceryListBtn.addEventListener("click", async () => {
  if (confirm("Are you sure you want to clear your entire grocery list?")) {
    try {
      const response = await fetch("/api/grocery_list", {
        method: "DELETE",
      });
      if (response.ok) {
        await fetchAndDisplayGroceryList();
      } else {
        alert("Failed to clear grocery list");
      }
    } catch (error) {
      console.error("Error clearing grocery list:", error);
    }
  }
});
