// Recipes view (SPEC §3.4, §3.7): the index at #/recipes (views/recipes-index.js) and the
// editor at #/recipes/<id> (views/recipe-editor.js, rows in views/recipe-ingredients.js).
// Moving between them goes through onParams, not a remount; each half gets its own cleanup
// scope. Both share one mutation queue (so fast entry, removals, renames and list adds land in
// order) and the "add to list" flow: the cull dialog, then a toast with Undo.

import { createQueue } from '../queue.js';
import { recipeIdParam } from '../recipes-model.js';
import { addRecipeWithCull } from '../components/cull-dialog.js';
import { createRecipesIndex } from './recipes-index.js';
import { createRecipeEditor } from './recipe-editor.js';

/** @type {{container: HTMLElement, ctx: object, actions: object, part: object|null, fromList: boolean} | null} */
let view = null;

/** ctx for one half: its subscriptions, listeners and cleanups end when the half is left. */
function scoped(ctx) {
  const cleanups = [];
  return {
    ctx: {
      ...ctx,
      subscribe(fn) {
        const off = ctx.store.subscribe(fn);
        cleanups.push(off);
        return off;
      },
      listen(target, type, fn, options) {
        target.addEventListener(type, fn, options);
        cleanups.push(() => target.removeEventListener(type, fn, options));
      },
      onCleanup(fn) {
        cleanups.push(fn);
      },
    },
    destroy() {
      for (const fn of cleanups.splice(0).reverse()) fn();
    },
  };
}

function createActions(ctx) {
  const { store, api, toast, navigate } = ctx;
  const queue = createQueue();

  function undo() {
    queue.run(() => api.quiet.undo()).then(
      () => toast('Undone'),
      (err) => {
        if (err?.status === 409) toast('Nothing to undo');
        else toast(err?.message ?? 'Undo failed', { variant: 'error' });
      },
    );
  }

  return {
    queue,
    undo,
    /** Cull dialog + POST; resolves whether the recipe went on the list. */
    addToList(recipe) {
      if (!recipe) return Promise.resolve(false);
      return queue
        .run(() => addRecipeWithCull({ recipe, store, api, toast, onUndo: undo, onEdit: () => navigate('recipes', recipe.id) }))
        .catch(() => false);
    },
    open(id) {
      navigate('recipes', id);
    },
    /** Creates a recipe (the api toasts errors) and opens its editor. */
    create(name) {
      return queue.run(() => api.createRecipe({ name })).then(
        ({ id }) => navigate('recipes', id),
        () => {},
      );
    },
  };
}

function show(params, { focusRecipe = null } = {}) {
  const { container, ctx, actions } = view;
  const hadFocus = container.contains(document.activeElement);
  view.part?.destroy();
  container.replaceChildren();
  container.className = 'view';
  const scope = scoped(ctx);
  const id = params.length ? recipeIdParam(params[0]) : undefined;
  const part =
    id === undefined
      ? createRecipesIndex(container, scope.ctx, actions, { focusRecipe: hadFocus ? focusRecipe : null })
      : createRecipeEditor(container, scope.ctx, actions, {
          id,
          back: view.fromList ? { view: 'list', label: 'List' } : { view: 'recipes', label: 'Recipes' },
          onFound: () => {
            if (view?.part?.recipeId === id) show(params);
          },
        });
  view.part = {
    ...part,
    destroy() {
      part.destroy?.();
      scope.destroy();
    },
  };
  // Focus was in the half that just went away: park it on the view for keyboards/screen readers.
  if (hadFocus && !container.contains(document.activeElement)) {
    document.getElementById('view-root')?.focus({ preventScroll: true });
  }
}

export default {
  id: 'recipes',
  title: 'Recipes',
  mount(container, ctx) {
    // Opened straight into an editor from the List view (+ Create recipe): "back" goes there.
    view = { container, ctx, actions: createActions(ctx), part: null, fromList: ctx.from === 'list' && ctx.params.length > 0 };
    show(ctx.params);
  },
  onParams(params) {
    if (!view) return;
    const leaving = view.part?.recipeId ?? null;
    view.fromList = false;
    show(params, { focusRecipe: params.length ? null : leaving });
    window.scrollTo(0, 0);
  },
  unmount() {
    view?.part?.destroy();
    view = null;
  },
  focusSearch() {
    view?.part?.focusSearch?.();
  },
};
