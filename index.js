const fs = require('fs');
const request = require('request-promise');
const chalk = require('chalk');
const clipboardy = require('clipboardy');

let _config = {};
let error = false;

readConfig();
if (!error) {
    if (process.argv.length <= 2) {
        parse();
    } else if (process.argv.includes('--consolidation') || process.argv
        .includes('-c')) {
        setInterval(consolidate, _config.consolidation_interval);
    }
}

async function consolidate() {}

async function parse() {
    //clear console
    process.stdout.write('\033c');
    let start = new Date();
    let result = [];

    //get all items from market
    let items = JSON.parse(await request(
        'https://api.warframe.market/v1/items')).payload.items;

    console.log('Found ' + chalk.green(items.length) +
        ' items. Filtering sets...');

    //get the items which names end with "_set"
    let sets = items
        .filter(item => item.url_name.endsWith('_set'))
        .map(item => item.url_name);

    console.log('Found ' + chalk.green(sets.length) +
        ' sets. Iterating...');

    //for each set
    for (let i = 0; i < sets.length; ++i) {

        let name = titleCase(sets[i].slice(0, sets[i].length - 4).split('_')
            .join(' '));
        console.log(chalk.green(i + 1) + ' / ' + sets.length + '\t' + (i <
            9 ? '\t' : '') + chalk.yellow(name));

        //get sibling parts of this item (sets, blueprints, chassis, systems, barrels, links etc...)
        let setParts = JSON.parse(await request(
                'https://api.warframe.market/v1/items/' + sets[i])).payload
            .item.items_in_set
            .map(item => {
                return {
                    //get its name and price in ducats
                    name: item.url_name,
                    ducats: item.ducats
                };
            })
            //make sure that "_set" item is always the first one in array
            .sort((a, b) => {

                if (a.name.includes('_set')) {
                    return -1;
                }

                if (b.name.includes('_set')) {
                    return 1;
                }

                return 0;
            });

        if (_config.only_warframes && !setParts.some(setPart => setPart.name
                .includes("neuroptics"))) {
            console.log("Only warframes. Skipping...");
            continue;
        }

        let ducats = setParts.map(setPart => (setPart.ducats == undefined ?
            0 : setPart.ducats));
        //get existing orders for each of the existing items (including sets)
        let allPartsOrders = await Promise.all(setParts.map(setPart =>
            request('https://api.warframe.market/v1/items/' +
                setPart.name + '/orders')));

        setParts.forEach(setPart => {
            console.log(chalk.yellow('\t\t> ') + titleCase(setPart
                .name.split('_').join(' ')));
        });

        allPartsOrders = allPartsOrders.map((curPartOrders, index) => {
            //filter the orders
            let order = JSON.parse(curPartOrders).payload.orders
                .filter(order =>
                    order.order_type == _config.type &&
                    _config.statuses.includes(order.user.status) &&
                    order.user.reputation >= _config
                    .min_reputation &&
                    order.platinum >= _config.min_price &&
                    order.platinum <= _config.max_price &&
                    _config.platforms.includes(order.platform) &&
                    _config.regions.includes(order.region) &&
                    order.visible)
                .sort((a, b) => {

                    if (a.platinum < b.platinum) {
                        return _config.type == 'sell' ? -1 : 1;
                    }

                    if (a.platinum > b.platinum) {
                        return _config.type == 'sell' ? 1 : -1;
                    }

                    return 0;
                })[index == 0 ? _config.set_position : _config
                    .part_position];
            if (order != undefined) {
                return {
                    platinum: order.platinum,
                    ducats: ducats[index],
                    message: '/w ' + order.user.ingame_name +
                        (_config.type == 'sell' ?
                            ' hi! wtb your [' : 'hi! wts my [') +
                        titleCase(setParts[
                            index].name.split('_').join(' ')) +
                        '] :)',
                    part: 'https://warframe.market/items/' +
                        setParts[index].name,
                    user: 'https://warframe.market/profile/' + order
                        .user.ingame_name,
                    update: formatDate(new Date(order.last_update))
                };
            }
        });

        //not found any orders for some parts of this set -> move on to the next one
        if (allPartsOrders.some(value => value == undefined)) {
            console.log(chalk.red('Error: No fitting orders found.'));
            continue;
        }

        //calculate the amount of plat needed to buy the set's parts and their sum in ducats
        let amounts = allPartsOrders.reduce((accumulator, currentValue) => {
            accumulator.needed += currentValue.part.endsWith(
                '_set') ? 0 : currentValue.platinum;
            accumulator.ducats += currentValue.ducats;
            return accumulator;
        }, {
            needed: 0,
            ducats: 0
        });

        result.push({
            ...{
                //get profit = set price - sum of part prices
                profit: allPartsOrders[0].platinum - amounts.needed,
                name,
                orders: allPartsOrders
            },
            ...amounts
        });
    }

    result = result.sort((a, b) => {
        if (a.profit < b.profit) {
            return _config.type == 'sell' ? 1 : -1;
        }

        if (a.profit > b.profit) {
            return _config.type == 'sell' ? -1 : 1;
        }

        return 0;
    });

    clipboardy.writeSync(result[0].orders.map(order => order.message).slice(
        1).join('\n'));

    let end = new Date();
    let formattedEnd = formatDate(end);
    fs.writeFileSync('./parse/' + formattedEnd.split(' ').join('_') + '.json',
        JSON.stringify({
            _config,
            start: formatDate(start),
            end: formattedEnd,
            duration: differenceInSeconds(start, end),
            result
        }, null, 2));
    process.exit();
}

function sortByPrice(a, b) {}

function formatDate(date) {
    let dd = date.getDate();
    let mm = date.getMonth() + 1; //January is 0!
    let yyyy = date.getFullYear();
    let hh = date.getHours();
    let minutes = date.getMinutes();
    var ss = date.getSeconds();

    if (dd < 10) {
        dd = '0' + dd;
    }
    if (mm < 10) {
        mm = '0' + mm;
    }
    if (hh < 10) {
        hh = '0' + hh;
    }
    if (minutes < 10) {
        minutes = '0' + minutes;
    }
    if (ss < 10) {
        ss = '0' + ss;
    }

    return dd + '.' + mm + '.' + yyyy + ' ' + hh + ':' + minutes + ':' + ss;
}

function titleCase(str) {
    return str.toLowerCase().split(' ').map(word => word.charAt(0)
        .toUpperCase() + word.substring(1)).join(' ');
}

function readConfig() {
    _config = JSON.parse(fs.readFileSync('config.json'));

    let typeValues = ['buy', 'sell'];
    let platformValues = ['pc', 'ps4', 'xbox'];
    let statusValues = ['ingame', 'online', 'offline'];
    let regionValues = ['en', 'ru', 'fr', 'de', 'ko', 'zh', 'sv'];

    if (!_config.hasOwnProperty('type') || !typeValues.includes(_config.type)) {
        error = true;
        console.log(chalk.red('Error, type can only be a part of [' + typeValues
            .map(value => "'" + value + "'").join(', ') + ']'));
    } else if (!_config.hasOwnProperty('platforms') || !_config.platforms ||
        _config.platforms.length == 0 || !_config
        .platforms.every(platform => platformValues.includes(platform))) {
        error = true;
        console.log(chalk.red('Error, platforms can only be a part of [' +
            platformValues.map(value => "'" + value + "'").join(', ') +
            ']'));
    } else if (!_config.hasOwnProperty('statuses') || !_config.statuses ||
        _config.statuses.length == 0 || !_config
        .statuses.every(status => statusValues.includes(status))) {
        error = true;
        console.log(chalk.red('Error, statuses can only be a part of [' +
            statusValues.map(value => "'" + value + "'").join(', ') +
            ']'));
    } else if (!_config.hasOwnProperty('regions') || !_config.regions || _config
        .regions.length == 0 || !_config
        .regions.every(region => regionValues.includes(region))) {
        error = true;
        console.log(chalk.red('Error, regions can only be a part of [' +
            regionValues.map(value => "'" + value + "'").join(', ') +
            ']'));
    }
}

function differenceInSeconds(date1, date2) {
    return Math.abs(date1.getTime() - date2.getTime()) / 1000;
}
