# Contributing

Yes please, raise a PR, make sure it passes the build.

To build:
```
npm install
npm run build
export NODE_CONFIG_TS_DIR=$(pwd)
export NODE_ENv=development
```

Create a directory and a default `development.json` file
```
mkdir -p $(pwd)/env
cp config/default.json env/development.json
```

.. and update the `development.json` before running

```
node lib/main.js
```


# For docker...
```
docker build -t onvif .
```

Try and follow the style of the code already; when I contribute to your repo, I'll follow the style that's there. 
