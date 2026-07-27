import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  Svg: React.ComponentType<React.ComponentProps<'svg'>>;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'AsteronEngine',
    Svg: require('@site/static/img/undraw_docusaurus_mountain.svg').default,
    description: (
      <>
        Electron authoring workspace for projects, scenes, prefabs, planets,
        Play mode, and <strong>File → Build Web</strong> releases.
      </>
    ),
  },
  {
    title: 'Authoritative backend',
    Svg: require('@site/static/img/undraw_docusaurus_tree.svg').default,
    description: (
      <>
        Rust cells with Rapier authority, shared WASM prediction, and Protobuf
        over WebTransport — clients send intents, the server owns outcomes.
      </>
    ),
  },
  {
    title: 'Scenes own content',
    Svg: require('@site/static/img/undraw_docusaurus_react.svg').default,
    description: (
      <>
        GameObject trees with components decide what a scene is. Switch scenes
        in-process — no page reloads, no separate admin app.
      </>
    ),
  },
];

function Feature({title, Svg, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center">
        <Svg className={styles.featureSvg} role="img" />
      </div>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
