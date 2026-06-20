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
