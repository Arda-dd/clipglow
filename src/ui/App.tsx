import { useEffect, useState } from 'react';
import { persist } from '../core/storage';
import { Editor } from './Editor';
import { Home } from './Home';

type Route = { kind: 'home' } | { kind: 'edit'; id: string };

function parse(): Route {
  const m = location.hash.match(/^#\/edit\/([\w-]+)/);
  return m ? { kind: 'edit', id: m[1] } : { kind: 'home' };
}

export const openProject = (id: string) => (location.hash = `#/edit/${id}`);
export const goHome = () => (location.hash = '#/');

export function App() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onHash = () => setRoute(parse());
    addEventListener('hashchange', onHash);
    void persist();
    return () => removeEventListener('hashchange', onHash);
  }, []);
  return route.kind === 'edit' ? <Editor key={route.id} id={route.id} /> : <Home />;
}
