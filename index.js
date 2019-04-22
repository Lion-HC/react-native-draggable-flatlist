import React, { Component, PureComponent } from 'react'
import {
  LayoutAnimation,
  YellowBox,
  Animated,
  FlatList,
  View,
  PanResponder,
  Platform,
  UIManager,
  StatusBar,
  StyleSheet,
} from 'react-native'

// Measure function triggers false positives
YellowBox.ignoreWarnings(['Warning: isMounted(...) is deprecated'])
UIManager.setLayoutAnimationEnabledExperimental && UIManager.setLayoutAnimationEnabledExperimental(true);

const initialState = {
  activeRow: -1,
  spacerSize: 0,
  showHoverComponent: false,
  spacerIndex: -1,
  scroll: false,
  hoverComponent: null,
  extraData: null,
}

class SortableFlatList extends Component {
  _moveAnim = new Animated.Value(0)
  _offset = new Animated.Value(0)
  _hoverAnim = Animated.add(this._moveAnim, this._offset)
  _spacerIndex = -1
  _scrollOffset = 0
  _container
  _containerSize
  _containerOffset
  _move = 0
  _hasMoved = false
  _refs = []
  _additionalOffset = 0
  _androidStatusBarOffset = 0
  _releaseVal = null
  _releaseAnim = null

  constructor(props) {
    super(props)
    this._panResponder = PanResponder.create({
      onStartShouldSetPanResponderCapture: (evt, gestureState) => {
        if (this._releaseAnim) {
          return false;
        }
        const { pageX, pageY } = evt.nativeEvent;
        this.measureContainer().then(x => {
          const { horizontal } = this.props;
          const tappedPixel = horizontal ? pageX : pageY;
          const relativePixel = this._scrollOffset - this._containerOffset + tappedPixel;
          const tappedRow = this.getRowIndexAt(relativePixel);
          if (tappedRow === -1) {
            return false;
          }
          const metrix = this._getFrameMetrics(tappedRow);
          this._additionalOffset = relativePixel - metrix.offset;
          this._moveAnim.setValue(tappedPixel)
          this._move = tappedPixel
          // compensate for translucent or hidden StatusBar on android
          if (Platform.OS === 'android' && !horizontal) {
            const isTranslucent = StatusBar._propsStack.reduce(((acc, cur) => {
              return cur.translucent === undefined ? acc : cur.translucent
            }), false)

            const isHidden = StatusBar._propsStack.reduce(((acc, cur) => {
              return cur.hidden === null ? acc : cur.hidden.value
            }), false)

            this._androidStatusBarOffset = (isTranslucent || isHidden) ? StatusBar.currentHeight : 0
          }

          this._offset.setValue((this._additionalOffset + this._containerOffset - this._androidStatusBarOffset) * -1)
        });
        return false;
      },
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        const { activeRow } = this.state
        const { horizontal } = this.props
        const { moveX, moveY } = gestureState
        const move = horizontal ? moveX : moveY
        const shouldSet = activeRow > -1
        this._moveAnim.setValue(move)
        if (shouldSet) {
          this.setState({ showHoverComponent: true })
          // Kick off recursive row animation
          this.animate()
          this._hasMoved = true
        }
        return shouldSet;
      },
      onPanResponderMove: Animated.event([null, { [props.horizontal ? 'moveX' : 'moveY']: this._moveAnim }], {
        listener: (evt, gestureState) => {
          const { moveX, moveY } = gestureState
          const { horizontal } = this.props
          this._move = horizontal ? moveX : moveY
        }
      }),
      onPanResponderTerminationRequest: ({ nativeEvent }, gestureState) => false,
      onPanResponderRelease: () => {
        const { activeRow, spacerIndex } = this.state
        const { data } = this.props
        // If user flings row up and lets go in the middle of an animation measurements can error out. 
        // Give layout animations some time to complete and animate element into place before calling onMoveEnd

        // Spacers have different positioning depending on whether the spacer row is before or after the active row.
        // This is because the active row animates to height 0, so everything after it shifts upwards, but everything before
        // it shifts downward
        const isAfterActive = spacerIndex > activeRow
        const isLastElement = spacerIndex >= data.length
        const spacerElement = this._getFrameMetrics(isLastElement ? data.length - 1 : spacerIndex);
        if (!spacerElement) return
        const { offset, length } = spacerElement;
        let pos = offset + this._containerOffset - this._scrollOffset + this._additionalOffset + (isLastElement ? length : 0)
        if (isLastElement) {
          pos -= this.state.spacerSize;
        }
        this._releaseVal = pos - (isAfterActive ? this._getFrameMetrics(activeRow).length : 0)
        if (this._releaseAnim) this._releaseAnim.stop()
        this._releaseAnim = Animated.spring(this._moveAnim, {
          toValue: this._releaseVal,
          stiffness: 5000,
          damping: 500,
          mass: 3,
          useNativeDriver: true,
        })

        this._releaseAnim.start(this.onReleaseAnimationEnd)
        this.moveEnd()
      }
    })
    this.state = initialState
  }

  onReleaseAnimationEnd = () => {
    const { data, onMoveEnd } = this.props
    const { activeRow, spacerIndex } = this.state
    const sortedData = this.getSortedList(data, activeRow, spacerIndex)
    const isAfterActive = spacerIndex > activeRow
    this._moveAnim.setValue(this._releaseVal)
    this._spacerIndex = -1
    this.setState(initialState)
    this._hasMoved = false
    this._move = 0
    this._releaseAnim = null
    onMoveEnd && onMoveEnd({
      row: data[activeRow],
      from: activeRow,
      to: spacerIndex - (isAfterActive ? 1 : 0),
      data: sortedData,
    })
  }

  getSortedList = (data, activeRow, spacerIndex) => {
    if (activeRow === spacerIndex) return data
    const sortedData = data.reduce((acc, cur, i, arr) => {
      if (i === activeRow) return acc
      else if (i === spacerIndex) {
        acc = [...acc, arr[activeRow], cur]
      } else acc.push(cur)
      return acc
    }, [])
    if (spacerIndex >= data.length) sortedData.push(data[activeRow])
    return sortedData
  }

  animate = () => {
    const { activeRow } = this.state
    const { scrollPercent, data, horizontal, scrollSpeed } = this.props
    const scrollRatio = scrollPercent / 100
    if (activeRow === -1) return
    const nextSpacerIndex = this.getSpacerIndex(this._move, activeRow)
    if (nextSpacerIndex > -1 && nextSpacerIndex !== this._spacerIndex) {
      LayoutAnimation.easeInEaseOut()
      this._oldSpacerIndex = this._spacerIndex;
      this._spacerIndex = nextSpacerIndex;
      this.setState({ spacerIndex: nextSpacerIndex })
      
      if (nextSpacerIndex === data.length && this.props.scrollEnabled) this._flatList.scrollToEnd()
    }

    // Scroll if hovering in top or bottom of container and have set a scroll %
    const isLastItem = (activeRow === data.length - 1) || nextSpacerIndex === data.length
    const isFirstItem = activeRow === 0

    var active = this._getFrameMetrics(activeRow);
    if (active) {
      const fingerPosition = Math.max(0, this._move - this._containerOffset)
      const shouldScrollUp = !isFirstItem && fingerPosition < (this._containerSize * scrollRatio)
      const shouldScrollDown = !isLastItem && fingerPosition > (this._containerSize * (1 - scrollRatio))
      if (shouldScrollUp) this.scroll(-scrollSpeed, nextSpacerIndex)
      else if (shouldScrollDown) this.scroll(scrollSpeed, nextSpacerIndex)
    }

    requestAnimationFrame(this.animate)
  }

  scroll = (scrollAmt, spacerIndex) => {
    if (this.props.scrollEnabled === false) return
    if (spacerIndex >= this.props.data.length) return this._flatList.scrollToEnd()
    if (spacerIndex === -1) return
    const currentScrollOffset = this._scrollOffset
    const newOffset = currentScrollOffset + scrollAmt
    const offset = Math.max(0, newOffset)
    this._flatList.scrollToOffset({ offset, animated: false })
  }

  getFrameAt = (hoverPoint) => {
    for (var key in this._frames) {
      if (this._frames.hasOwnProperty(key)) {
        const frame = this._frames[key];
        if (hoverPoint > frame.offset && hoverPoint < (frame.offset + frame.length) && frame.inLayout) {
          return frame;
        }
      }
    }
    return undefined;
  }

  getRowIndexAt = (hoverPoint) => {
    const frame = this.getFrameAt(hoverPoint);
    return frame ? frame.index : -1;
  }

  getSpacerIndex = (move, activeRow) => {
    const { horizontal } = this.props;
    if (activeRow === -1){
      return -1;
    }
    // Find the row that contains the midpoint of the hovering item
    const hoverItemSize = this.state.spacerSize;
    const hoverItemMidpoint = move - this._additionalOffset + hoverItemSize / 2
    const hoverPoint = Math.floor(hoverItemMidpoint + this._scrollOffset)
    const frame = this.getFrameAt(hoverPoint - this._containerOffset);
    if (!frame) {
      return -1;
    }
    let spacerIndex = frame.index;
    if (hoverPoint > this._containerOffset + frame.offset + Math.min(frame.length, this.state.spacerSize)) {
      spacerIndex ++;
    }
    return spacerIndex;
  }

  measureContainer = async() => {
    const { horizontal } = this.props;
    try{
      return await new Promise(resolve => {
        this._container.measure((x, y, width, height, pageX, pageY) => {
          this._containerOffset = horizontal ? pageX : pageY;
          this._containerSize = horizontal ? width : height;
          resolve(true);
        });
      });
    }
    catch (ex) {
      console.log("Cannot measure container", ex);
      return false;
    }
  }

  move = async(hoverComponent, index) => {
    const { onBeforeMove, onMoveBegin } = this.props
    if (this._releaseAnim) {
      this._releaseAnim.stop()
      this.onReleaseAnimationEnd()
      return
    }
    this._spacerIndex = index
    if (onBeforeMove) {
      await onBeforeMove(index);
    }
    await new Promise(resolve => this.setState({
      activeRow: index,
      spacerIndex: index,
      spacerSize: this._getFrameMetrics(index).length,
      hoverComponent,
    }, resolve));
    if (onMoveBegin) {
      await onMoveBegin(index);
    }
  }

  moveEnd = () => {
    if (!this._hasMoved) this.setState(initialState)
  }

  setRef = index => (ref) => {
    if (!!ref) {
      this._refs[index] = ref
    }
  }

  onChildLayout = (index, event) => {
    if (index === this.state.activeRow) {
      const { horizontal } = this.props;
      const spacerSize = event.nativeEvent.layout[horizontal ? 'width' : 'height'];
      if (spacerSize > 0) {
        this.setState({spacerSize});
      }
    }
  }

  renderItem = ({ item, index }) => {
    const { renderItem, data, horizontal } = this.props
    const { activeRow, spacerIndex } = this.state
    const isSpacerRow = spacerIndex === index
    const spacerSize = isSpacerRow ? this.state.spacerSize : 0;
    const endPadding = index === data.length - 1 && spacerIndex === data.length && this.state.spacerSize;
    return (
      <RowItem
        horizontal={horizontal}
        index={index}
        isActiveRow={activeRow === index}
        isLastRow={index === data.length - 1}
        spacerSize={spacerSize}
        renderItem={renderItem}
        item={item}
        setRef={this.setRef}
        onChildLayout={this.onChildLayout}
        move={this.move}
        moveEnd={this.moveEnd}
        endPadding={endPadding}
        extraData={this.state.extraData}
      />
    )
  }

  renderHoverComponent = () => {
    const { hoverComponent } = this.state
    const { horizontal } = this.props
    return !!hoverComponent && (
      <Animated.View style={[
        horizontal ? styles.hoverComponentHorizontal : styles.hoverComponentVertical,
        { transform: [horizontal ? { translateX: this._hoverAnim } : { translateY: this._hoverAnim }] }]} >
        {hoverComponent}
      </Animated.View>
    )
  }

  keyExtractor = (item, index) => `sortable-flatlist-item-${index}`

  componentDidUpdate = (prevProps, prevState) => {
    if (prevProps.extraData !== this.props.extraData) {
      this.setState({ extraData: this.props.extraData })
    }
  }

  render() {
    const { wrap } = this.props
    this._refs = []
    return (
      <View collapsable={false}
        ref={ref => (this._container = ref)}
        {...this._panResponder.panHandlers}
        style={styles.wrapper} // Setting { opacity: 1 } fixes Android measurement bug: https://github.com/facebook/react-native/issues/18034#issuecomment-368417691
      >
        {wrap ? wrap(this.renderFlatList()) : this.renderFlatList()}
        {this.renderHoverComponent()}
      </View>
    )
  }

  renderFlatList() {
    const { horizontal, keyExtractor, extraData, scrollEnabled } = this.props
    const extraDataWithState = Object.assign({}, extraData, this.state);
    return (
      <FlatList
        {...this.props}
        scrollEnabled={scrollEnabled && this.state.activeRow === -1}
        ref={ref => {
          this._flatList = ref;
          if (ref) {
            this._virtList = this._flatList._listRef;
            this._frames = this._virtList._frames;
            this._getFrameMetrics = this._virtList._getFrameMetrics;
          }
        }}
        renderItem={this.renderItem}
        extraData={extraDataWithState}
        keyExtractor={keyExtractor || this.keyExtractor}
        onScroll={x => { 
          if (scrollEnabled) {
            this._scrollOffset = x.nativeEvent.contentOffset[horizontal ? 'x' : 'y']
            this.props.onScroll && this.props.onScroll(x)
          }
        }}
        scrollEventThrottle={16}
      />
    )
  }
}

export default SortableFlatList

SortableFlatList.defaultProps = {
  scrollPercent: 5,
  scrollSpeed:5,
  contentContainerStyle: {},
}

class RowItem extends PureComponent {

  renderSpacer = (size) => <View style={this.props.horizontal ? { width: size } : { height: size }} />

  move = () => {
    const { move, moveEnd, renderItem, item, index } = this.props
    const hoverComponent = renderItem({ isActive: true, item, index, move: () => null, moveEnd })
    move(hoverComponent, index)
  }

  render() {
    const { moveEnd, isActiveRow, isLastRow, horizontal, endPadding, spacerSize, renderItem, item, index, setRef, onChildLayout } = this.props
    const component = renderItem({
      isActive: false,
      item,
      index,
      move: this.move,
      moveEnd,
    })
    // Rendering the final row requires padding to be applied at the bottom
    return (
      <View ref={setRef(index)} onLayout={e => onChildLayout(index, e)} collapsable={false} style={{ opacity: 1, flexDirection: horizontal ? 'row' : 'column' }}>
        {!!spacerSize && this.renderSpacer(spacerSize)}
        <View style={[
          horizontal ? { width: isActiveRow ? 0 : undefined } : { height: isActiveRow ? 0 : undefined },
          { opacity: isActiveRow ? 0 : 1, overflow: 'hidden' }
        ]}>
          {component}
        </View>
        {
          // Wrap endPadding spacer into View to fix Windows UIManager bug
          // If spacerSize & endPadding spacers are at the same level (have the same parent),
          // switching from one to another and back accidentally removes main wrapped component,
          // probably due to wrong index to remove when removed and dropped by the 'delete' layout animation (direct deletion works fine)
          !!isLastRow && <View opacity={1}>
            {!!endPadding && this.renderSpacer(endPadding)}
          </View>
        }
      </View>
    )
  }
}

const styles = StyleSheet.create({
  hoverComponentVertical: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  hoverComponentHorizontal: {
    position: 'absolute',
    bottom: 0,
    top: 0,
  },
  wrapper: { flex: 1, opacity: 1 }
})