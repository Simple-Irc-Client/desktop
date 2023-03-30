#!/bin bash
git clone git@github.com:Simple-Irc-Client/core.git
git clone git@github.com:Simple-Irc-Client/network.git

cd core
npm ci
npm run build
cp -r dist/* ../src
cd ..

cd network
npm ci
npm run build
mv irc-network.js ../src
cd ..
